const createRoomInput = document.getElementById('createRoomInput');
const createRoomButton = document.getElementById('createRoomButton');
const joinRoomInput = document.getElementById('joinRoomInput');
const joinRoomButton = document.getElementById('joinRoomButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusEl = document.getElementById('status');

let ws = null;
let pc = null;
let localStream = null;
let isCaller = false;
let hasReady = false;
let joined = false;
let candidateQueue = [];
let remoteDescriptionSet = false;

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function setStatus(message, type = '') {
    statusEl.textContent = message || '';
    statusEl.className = '';
    if (type) {
        statusEl.classList.add(`status-${type}`);
    }
}

function createPeerConnection() {
    pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
    });

    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            console.log('Sending ICE candidate:', event.candidate.candidate.substring(0, 50) + '...');
            ws.send(JSON.stringify({
                type: 'candidate',
                candidate: event.candidate
            }));
        } else if (!event.candidate) {
            console.log('ICE candidate gathering complete');
        }
    };

    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        console.log('ICE connection state changed:', state);
        if (state === 'connected' || state === 'completed') {
            setStatus('✅ Connected. Streaming media...', 'connected');
        } else if (state === 'disconnected') {
            setStatus('⚠️ Peer disconnected.', 'error');
        } else if (state === 'failed') {
            setStatus('❌ Connection failed.', 'error');
        } else if (state === 'checking') {
            setStatus('🔄 Establishing connection...', 'waiting');
        }
    };

    pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
}

async function getLocalMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        localVideo.srcObject = localStream;
    } catch (err) {
        console.error('getUserMedia error', err);
        setStatus('❌ Camera or microphone access denied.', 'error');
        throw err;
    }
}

function connectWebSocket(roomId) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}`;
    console.log('Connecting WebSocket to:', wsUrl);
    ws = new WebSocket(wsUrl);
    
    // Ensure we receive text messages, not binary
    ws.binaryType = 'arraybuffer';

    ws.onopen = async () => {
        console.log('WebSocket connected');
        try {
            await getLocalMedia();
        } catch {
            return;
        }

        const joinMsg = JSON.stringify({
            type: 'join',
            room: roomId
        });
        console.log('Sending join message:', joinMsg);
        ws.send(joinMsg);
        setStatus(`Joined room ${roomId}. Waiting for peer...`, 'waiting');
    };

    ws.onmessage = async (event) => {
        let messageText;
        
        // Handle different message types
        if (typeof event.data === 'string') {
            messageText = event.data;
        } else if (event.data instanceof Blob) {
            messageText = await event.data.text();
        } else if (event.data instanceof ArrayBuffer) {
            messageText = new TextDecoder().decode(event.data);
        } else {
            // Fallback: try to convert to string
            messageText = String(event.data);
        }
        
        let data;
        try {
            data = JSON.parse(messageText);
        } catch (e) {
            console.error('Failed to parse WebSocket message:', e, 'Raw data type:', typeof event.data, 'Data:', event.data);
            return;
        }

        console.log('WS message received:', data.type, data);

        const type = data.type;

        if (type === 'ready') {
            console.log('Received ready message, role:', data.role);
            if (hasReady) {
                console.log('Already received ready, ignoring duplicate');
                return; // ignore duplicate ready
            }
            hasReady = true;

            // Role is assigned by server: "caller" or "callee"
            isCaller = data.role === 'caller';
            console.log('isCaller:', isCaller);

            if (!pc) {
                console.log('Creating peer connection...');
                createPeerConnection();
                remoteDescriptionSet = false;
                candidateQueue = [];
            }

            if (isCaller) {
                console.log('Creating offer as caller...');
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    const offerMsg = JSON.stringify({
                        type: 'offer',
                        offer
                    });
                    console.log('Sending offer message, size:', offerMsg.length, 'bytes');
                    ws.send(offerMsg);
                    setStatus('Offer sent. Waiting for answer...', 'waiting');
                    console.log('Offer sent');
                } catch (err) {
                    console.error('Error creating offer', err);
                }
            } else {
                console.log('Waiting for offer as callee...');
                setStatus('Ready. Waiting for offer...', 'waiting');
            }
            return;
        }

        if (type === 'offer') {
            console.log('Received offer message');
            if (!pc) {
                createPeerConnection();
            }
            try {
                // Use the SDP object directly to avoid constructor issues
                await pc.setRemoteDescription(data.offer);
                remoteDescriptionSet = true;
                console.log('Remote description set from offer');
                
                // Process any queued candidates
                console.log(`Processing ${candidateQueue.length} queued candidates...`);
                for (const candidate of candidateQueue) {
                    try {
                        await pc.addIceCandidate(candidate);
                    } catch (err) {
                        console.error('Error adding queued ICE candidate', err);
                    }
                }
                candidateQueue = [];
                
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                console.log('Answer created and local description set, sending answer...');
                const answerMsg = JSON.stringify({
                    type: 'answer',
                    answer
                });
                console.log('Sending answer message, size:', answerMsg.length, 'bytes');
                ws.send(answerMsg);
                setStatus('Answer sent. Establishing connection...', 'waiting');
                console.log('Answer sent');
            } catch (err) {
                console.error('Error handling offer', err);
                setStatus('❌ Error processing offer: ' + err.message, 'error');
            }
            return;
        }

        if (type === 'answer') {
            console.log('Received answer message');
            try {
                await pc.setRemoteDescription(data.answer);
                remoteDescriptionSet = true;
                console.log('Remote description set, connection should be establishing...');
                
                // Process any queued candidates
                console.log(`Processing ${candidateQueue.length} queued candidates...`);
                for (const candidate of candidateQueue) {
                    try {
                        await pc.addIceCandidate(candidate);
                    } catch (err) {
                        console.error('Error adding queued ICE candidate', err);
                    }
                }
                candidateQueue = [];
                
                setStatus('✅ Connected. Streaming media...', 'connected');
            } catch (err) {
                console.error('Error handling answer', err);
                setStatus('❌ Error processing answer: ' + err.message, 'error');
            }
            return;
        }

        if (type === 'candidate') {
            console.log('Received ICE candidate');
            if (!data.candidate) {
                console.log('Received null candidate (end of candidates)');
                return;
            }
            
            // If remote description isn't set yet, queue the candidate
            if (!remoteDescriptionSet) {
                console.log('Remote description not set yet, queuing candidate');
                candidateQueue.push(data.candidate);
                return;
            }
            
            try {
                await pc.addIceCandidate(data.candidate);
                console.log('ICE candidate added successfully');
            } catch (err) {
                console.error('Error adding ICE candidate', err);
            }
            return;
        }
    };

    ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setStatus('❌ Connection lost.', 'error');
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('❌ Connection error.', 'error');
    };
}

createRoomButton.addEventListener('click', () => {
    if (joined) return;
    let roomId = createRoomInput.value.trim();
    if (!roomId) {
        roomId = generateRoomId();
        createRoomInput.value = roomId;
    }
    joined = true;
    createRoomButton.disabled = true;
    joinRoomButton.disabled = true;
    createRoomInput.disabled = true;
    joinRoomInput.disabled = true;
    setStatus(`✅ Room created: ${roomId}. Share this ID with your guest.`, 'waiting');
    connectWebSocket(roomId);
});

joinRoomButton.addEventListener('click', () => {
    if (joined) return;
    const roomId = joinRoomInput.value.trim();
    if (!roomId) {
        setStatus('⚠️ Please enter a meeting ID to join.', 'error');
        return;
    }
    joined = true;
    createRoomButton.disabled = true;
    joinRoomButton.disabled = true;
    createRoomInput.disabled = true;
    joinRoomInput.disabled = true;
    setStatus(`Joining room ${roomId}...`, 'waiting');
    connectWebSocket(roomId);
});


