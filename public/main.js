const createRoomInput = document.getElementById('createRoomInput');
const createRoomButton = document.getElementById('createRoomButton');
const joinRoomInput = document.getElementById('joinRoomInput');
const joinRoomButton = document.getElementById('joinRoomButton');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusEl = document.getElementById('status');
const localTranslationText = document.getElementById('localTranslationText');
const remoteTranslationText = document.getElementById('remoteTranslationText');
const localTranslation = document.getElementById('localTranslation');
const remoteTranslation = document.getElementById('remoteTranslation');
const targetLanguageSelect = document.getElementById('targetLanguage');
const enableTranslationCheckbox = document.getElementById('enableTranslation');
const endCallButton = document.getElementById('endCallButton');

// Defensive check for required elements
if (!localTranslationText || !remoteTranslationText || !localTranslation || 
    !remoteTranslation || !targetLanguageSelect || !enableTranslationCheckbox) {
    console.warn('Some translation UI elements are missing');
}

let ws = null;
let pc = null;
let localStream = null;
let isCaller = false;
let hasReady = false;
let joined = false;
let candidateQueue = [];
let remoteDescriptionSet = false;
let currentRoomId = null;
let userId = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let transcriptionInterval = null;
let myDetectedLanguage = null;
let peerDetectedLanguage = null;

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
            // Show end call button
            if (endCallButton) {
                endCallButton.classList.add('active');
            }
            // Start audio recording for transcription when connected
            if (enableTranslationCheckbox && enableTranslationCheckbox.checked) {
                startAudioRecording();
            }
        } else if (state === 'disconnected') {
            stopAudioRecording();
            // Hide end call button
            if (endCallButton) {
                endCallButton.classList.remove('active');
            }
            setStatus('⚠️ Peer disconnected.', 'error');
        } else if (state === 'failed') {
            setStatus('❌ Connection failed.', 'error');
            // Hide end call button
            if (endCallButton) {
                endCallButton.classList.remove('active');
            }
        } else if (state === 'checking') {
            setStatus('🔄 Establishing connection...', 'waiting');
        } else if (state === 'closed') {
            // Hide end call button
            if (endCallButton) {
                endCallButton.classList.remove('active');
            }
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

        // Generate unique user ID
        userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        currentRoomId = roomId;

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
                // Show end call button
                if (endCallButton) {
                    endCallButton.classList.add('active');
                }
                // Start audio recording for transcription when connected
                if (enableTranslationCheckbox && enableTranslationCheckbox.checked) {
                    startAudioRecording();
                }
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

        if (type === 'translation') {
            console.log('Received translation from peer');
            if (data.translatedText) {
                displayRemoteTranslation(data.translatedText);
            }
            if (data.detectedLanguage) {
                peerDetectedLanguage = data.detectedLanguage;
            }
            return;
        }
    };

    ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setStatus('❌ Connection lost.', 'error');
        stopAudioRecording();
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('❌ Connection error.', 'error');
    };
}

// Speech-to-text and translation functions
function startAudioRecording() {
    if (!localStream || isRecording) return;
    
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) {
        console.warn('No audio track available');
        return;
    }

    try {
        // Create a new stream with just the audio track
        const audioStream = new MediaStream(audioTracks);
        
        // Use MediaRecorder to capture audio
        const options = {
            mimeType: 'audio/webm;codecs=opus',
            audioBitsPerSecond: 128000
        };

        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            options.mimeType = 'audio/webm';
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'audio/ogg;codecs=opus';
            }
        }

        mediaRecorder = new MediaRecorder(audioStream, options);
        audioChunks = [];
        isRecording = true;

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            if (audioChunks.length === 0) return;
            
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
            await processAudioForTranscription(audioBlob);
            audioChunks = [];
        };

        // Record in chunks (every 3 seconds)
        mediaRecorder.start();
        console.log('Audio recording started');

        // Stop and restart every 3 seconds to process chunks
        transcriptionInterval = setInterval(() => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                setTimeout(() => {
                    if (isRecording && localStream) {
                        const audioTracks = localStream.getAudioTracks();
                        if (audioTracks.length > 0) {
                            const audioStream = new MediaStream(audioTracks);
                            mediaRecorder = new MediaRecorder(audioStream, options);
                            audioChunks = [];
                            mediaRecorder.ondataavailable = (event) => {
                                if (event.data.size > 0) {
                                    audioChunks.push(event.data);
                                }
                            };
                            mediaRecorder.onstop = async () => {
                                if (audioChunks.length === 0) return;
                                const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
                                await processAudioForTranscription(audioBlob);
                                audioChunks = [];
                            };
                            mediaRecorder.start();
                        }
                    }
                }, 100);
            }
        }, 3000);

    } catch (error) {
        console.error('Error starting audio recording:', error);
    }
}

function stopAudioRecording() {
    isRecording = false;
    if (transcriptionInterval) {
        clearInterval(transcriptionInterval);
        transcriptionInterval = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    mediaRecorder = null;
    audioChunks = [];
}

async function processAudioForTranscription(audioBlob) {
    if (!enableTranslationCheckbox.checked || !currentRoomId) return;

    try {
        // Convert blob to base64
        const reader = new FileReader();
        const audioBase64 = await new Promise((resolve, reject) => {
            reader.onloadend = () => {
                const base64String = reader.result.split(',')[1];
                resolve(base64String);
            };
            reader.onerror = reject;
            reader.readAsDataURL(audioBlob);
        });

        // Send to server for transcription
        const response = await fetch('/api/speech-to-text', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                audioData: audioBase64,
                roomId: currentRoomId,
                userId: userId
            })
        });

        if (!response.ok) {
            throw new Error('Speech-to-text request failed');
        }

        const result = await response.json();
        
        if (result.transcript && result.transcript.trim().length > 0) {
            console.log('Transcribed:', result.transcript);
            console.log('Detected language:', result.detectedLanguage);
            
            myDetectedLanguage = result.detectedLanguage;
            displayLocalTranslation(result.transcript);

            // Translate to target language
            const targetLanguage = targetLanguageSelect.value;
            if (targetLanguage && result.transcript) {
                await translateAndSend(result.transcript, targetLanguage, result.detectedLanguage);
            }
        }
    } catch (error) {
        console.error('Error processing audio:', error);
    }
}

// Convert 5-letter language code (en-US) to 2-letter (en)
function convertLanguageCode(langCode) {
    if (!langCode) return 'en';
    const parts = langCode.split('-');
    return parts[0];
}

async function translateAndSend(text, targetLanguage, sourceLanguage) {
    try {
        // Convert source language from 5-letter to 2-letter code if needed
        const sourceLang = convertLanguageCode(sourceLanguage);
        
        const response = await fetch('/api/translate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                targetLanguage: targetLanguage,
                sourceLanguage: sourceLang, // Optional, helps with accuracy
                roomId: currentRoomId,
                userId: userId
            })
        });

        if (!response.ok) {
            throw new Error('Translation request failed');
        }

        const result = await response.json();
        
        if (result.translatedText) {
            console.log('Translated:', result.translatedText);
            
            // Send translation to peer via WebSocket
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'translation',
                    translatedText: result.translatedText,
                    originalText: text,
                    sourceLanguage: sourceLanguage,
                    targetLanguage: targetLanguage,
                    detectedLanguage: sourceLanguage
                }));
            }
        }
    } catch (error) {
        console.error('Error translating text:', error);
    }
}

function displayLocalTranslation(text) {
    if (!localTranslationText || !localTranslation) return;
    if (text && text.trim()) {
        localTranslationText.textContent = text;
        localTranslation.classList.add('active');
        
        // Auto-hide after 5 seconds if no new text
        setTimeout(() => {
            if (localTranslationText && localTranslationText.textContent === text) {
                localTranslation.classList.remove('active');
            }
        }, 5000);
    }
}

function displayRemoteTranslation(text) {
    if (!remoteTranslationText || !remoteTranslation) return;
    if (text && text.trim()) {
        remoteTranslationText.textContent = text;
        remoteTranslation.classList.add('active');
        
        // Auto-hide after 5 seconds if no new text
        setTimeout(() => {
            if (remoteTranslationText && remoteTranslationText.textContent === text) {
                remoteTranslation.classList.remove('active');
            }
        }, 5000);
    }
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

// Handle translation toggle
if (enableTranslationCheckbox) {
    enableTranslationCheckbox.addEventListener('change', (e) => {
        if (e.target.checked && pc && (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed')) {
            startAudioRecording();
        } else {
            stopAudioRecording();
            if (localTranslation) localTranslation.classList.remove('active');
            if (remoteTranslation) remoteTranslation.classList.remove('active');
        }
    });
}

// Handle target language change
if (targetLanguageSelect) {
    targetLanguageSelect.addEventListener('change', () => {
        // Language preference updated
        console.log('Target language changed to:', targetLanguageSelect.value);
    });
}

// End call function
function endCall() {
    console.log('Ending call...');
    
    // Stop audio recording
    stopAudioRecording();
    
    // Close peer connection
    if (pc) {
        pc.getSenders().forEach(sender => {
            if (sender.track) {
                sender.track.stop();
            }
        });
        pc.getReceivers().forEach(receiver => {
            if (receiver.track) {
                receiver.track.stop();
            }
        });
        pc.close();
        pc = null;
    }
    
    // Stop local media stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }
    
    // Clear video elements
    if (localVideo) {
        localVideo.srcObject = null;
    }
    if (remoteVideo) {
        remoteVideo.srcObject = null;
    }
    
    // Close WebSocket connection
    if (ws) {
        ws.close();
        ws = null;
    }
    
    // Reset state
    hasReady = false;
    joined = false;
    candidateQueue = [];
    remoteDescriptionSet = false;
    currentRoomId = null;
    userId = null;
    myDetectedLanguage = null;
    peerDetectedLanguage = null;
    
    // Hide end call button
    if (endCallButton) {
        endCallButton.classList.remove('active');
    }
    
    // Clear translation boxes
    if (localTranslation) localTranslation.classList.remove('active');
    if (remoteTranslation) remoteTranslation.classList.remove('active');
    if (localTranslationText) localTranslationText.textContent = '';
    if (remoteTranslationText) remoteTranslationText.textContent = '';
    
    // Re-enable room controls
    if (createRoomButton) createRoomButton.disabled = false;
    if (joinRoomButton) joinRoomButton.disabled = false;
    if (createRoomInput) {
        createRoomInput.disabled = false;
        createRoomInput.value = '';
    }
    if (joinRoomInput) {
        joinRoomInput.disabled = false;
        joinRoomInput.value = '';
    }
    
    // Update status
    setStatus('Call ended. You can create or join a new room.', '');
}

// Handle end call button click
if (endCallButton) {
    endCallButton.addEventListener('click', () => {
        endCall();
    });
}


