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

function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function setStatus(message) {
    statusEl.textContent = message || '';
}

function createPeerConnection() {
    pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    });

    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'candidate',
                candidate: event.candidate
            }));
        }
    };

    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === 'disconnected') {
            setStatus('Peer disconnected.');
        } else if (state === 'failed') {
            setStatus('Connection failed.');
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
        setStatus('Camera or microphone access denied.');
        throw err;
    }
}

function connectWebSocket(roomId) {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = async () => {
        try {
            await getLocalMedia();
        } catch {
            return;
        }

        ws.send(JSON.stringify({
            type: 'join',
            room: roomId
        }));
        setStatus(`Joined room ${roomId}. Waiting for peer...`);
    };

    ws.onmessage = async (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }

        const type = data.type;

        if (type === 'ready') {
            if (hasReady) return; // ignore duplicate ready
            hasReady = true;

            // Role is assigned by server: "caller" or "callee"
            isCaller = data.role === 'caller';

            if (!pc) {
                createPeerConnection();
            }

            if (isCaller) {
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    ws.send(JSON.stringify({
                        type: 'offer',
                        offer
                    }));
                    setStatus('Offer sent. Waiting for answer...');
                } catch (err) {
                    console.error('Error creating offer', err);
                }
            } else {
                setStatus('Ready. Waiting for offer...');
            }
            return;
        }

        if (type === 'offer') {
            if (!pc) {
                createPeerConnection();
            }
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                ws.send(JSON.stringify({
                    type: 'answer',
                    answer
                }));
                setStatus('Answer sent. Establishing connection...');
            } catch (err) {
                console.error('Error handling offer', err);
            }
            return;
        }

        if (type === 'answer') {
            try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                setStatus('Connected. Streaming media...');
            } catch (err) {
                console.error('Error handling answer', err);
            }
            return;
        }

        if (type === 'candidate') {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
                console.error('Error adding ICE candidate', err);
            }
            return;
        }
    };

    ws.onclose = () => {
        setStatus('Connection lost.');
    };

    ws.onerror = () => {
        setStatus('Connection lost.');
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
    setStatus(`Room created: ${roomId}. Share this ID with your guest.`);
    connectWebSocket(roomId);
});

joinRoomButton.addEventListener('click', () => {
    if (joined) return;
    const roomId = joinRoomInput.value.trim();
    if (!roomId) {
        setStatus('Please enter a meeting ID to join.');
        return;
    }
    joined = true;
    createRoomButton.disabled = true;
    joinRoomButton.disabled = true;
    createRoomInput.disabled = true;
    joinRoomInput.disabled = true;
    setStatus(`Joining room ${roomId}...`);
    connectWebSocket(roomId);
});


