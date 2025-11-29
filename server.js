require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);

const WebSocket = require('ws');
const wss = new WebSocket.Server({ server: http });

const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static frontend files from public directory
app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

wss.on('connection', (ws) => {
    console.log('New WebSocket connection');
    
    ws.on('message', (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch (e) {
            // Ignore malformed JSON
            return;
        }

        const type = data.type;

        if (type === 'join') {
            const room = data.room;
            if (!room || typeof room !== 'string') return;

            if (!rooms[room]) rooms[room] = [];
            rooms[room].push(ws);
            ws.room = room;

            console.log(`Client joined room ${room}. Size now: ${rooms[room].length}`);

            if (rooms[room].length === 2) {
                // First joined becomes caller, second becomes callee
                console.log(`Room ${room} has 2 clients, sending ready messages...`);
                rooms[room].forEach((client, index) => {
                    if (client.readyState === WebSocket.OPEN) {
                        const role = index === 0 ? 'caller' : 'callee';
                        const readyMsg = JSON.stringify({
                            type: 'ready',
                            role: role
                        });
                        client.send(readyMsg);
                        console.log(`Sent ready message to ${role} in room ${room}`);
                    } else {
                        console.log(`Client ${index} in room ${room} is not OPEN (state: ${client.readyState})`);
                    }
                });
            }
            return;
        }

        if (['offer', 'answer', 'candidate'].includes(type)) {
            const roomId = ws.room;
            if (!roomId || !rooms[roomId]) {
                console.log(`Warning: ${type} message from client not in a room`);
                return;
            }
            console.log(`Relaying ${type} in room ${roomId} to ${rooms[roomId].length - 1} other client(s)`);
            let sentCount = 0;
            rooms[roomId].forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(msg);
                    sentCount++;
                }
            });
            if (sentCount === 0) {
                console.log(`Warning: ${type} message not sent - no other open clients in room ${roomId}`);
            }
            return;
        }

        if (type === 'translation') {
            const roomId = ws.room;
            if (!roomId || !rooms[roomId]) {
                return;
            }
            // Relay translation to other peer
            rooms[roomId].forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(msg);
                }
            });
            return;
        }

        // Ignore unknown message types
    });

    ws.on('close', () => {
        if (!ws.room) return;
        const roomId = ws.room;
        if (!rooms[roomId]) return;
        rooms[roomId] = rooms[roomId].filter(c => c !== ws);
        if (rooms[roomId].length === 0) {
            delete rooms[roomId];
        }
    });
});

// Store user language preferences per room
const roomLanguages = {};

// API endpoint for speech-to-text with language detection
app.post('/api/speech-to-text', async (req, res) => {
    try {
        const { audioData, roomId, userId } = req.body;
        
        if (!audioData) {
            return res.status(400).json({ error: 'Audio data is required' });
        }

        const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Google Cloud API key not configured' });
        }

        // Convert base64 audio to buffer
        const audioBuffer = Buffer.from(audioData, 'base64');

        // Use Google Cloud Speech-to-Text API with language detection
        // Try different encodings based on what the client sends
        const configs = [
            {
                encoding: 'WEBM_OPUS',
                sampleRateHertz: 48000,
            },
            {
                encoding: 'OGG_OPUS',
                sampleRateHertz: 48000,
            },
            {
                encoding: 'LINEAR16',
                sampleRateHertz: 16000,
            }
        ];

        let response = null;
        let lastError = null;

        for (const encodingConfig of configs) {
            try {
                response = await axios.post(
                    `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
                    {
                        config: {
                            ...encodingConfig,
                            languageCode: 'en-US', // Primary language, will auto-detect from alternatives
                            alternativeLanguageCodes: ['es-ES', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN', 'ar-SA', 'hi-IN', 'ru-RU', 'nl-NL'],
                            model: 'latest_long',
                            enableAutomaticPunctuation: true,
                        },
                        audio: {
                            content: audioBuffer.toString('base64')
                        }
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    }
                );
                break; // Success, exit loop
            } catch (error) {
                lastError = error;
                console.log(`Trying next encoding format...`);
            }
        }

        if (!response) {
            throw lastError || new Error('All encoding formats failed');
        }

        if (response.data.results && response.data.results.length > 0) {
            const transcript = response.data.results[0].alternatives[0].transcript;
            // Try to get detected language from result, fallback to first alternative language
            const detectedLanguage = response.data.results[0].languageCode || 
                                   response.data.results[0].resultEndTime?.languageCode ||
                                   'en-US';
            
            // Store detected language for this user in the room
            if (!roomLanguages[roomId]) {
                roomLanguages[roomId] = {};
            }
            roomLanguages[roomId][userId] = detectedLanguage;

            res.json({
                transcript,
                detectedLanguage,
                confidence: response.data.results[0].alternatives[0].confidence || 0
            });
        } else {
            res.json({
                transcript: '',
                detectedLanguage: null,
                confidence: 0
            });
        }
    } catch (error) {
        console.error('Speech-to-text error:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Speech-to-text failed',
            details: error.response?.data || error.message 
        });
    }
});

// API endpoint for translation
app.post('/api/translate', async (req, res) => {
    try {
        const { text, targetLanguage, sourceLanguage, roomId, userId } = req.body;
        
        if (!text || !targetLanguage) {
            return res.status(400).json({ error: 'Text and target language are required' });
        }

        const apiKey = process.env.GOOGLE_CLOUD_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Google Cloud API key not configured' });
        }

        // Use Google Cloud Translation API
        const requestBody = {
            q: text,
            target: targetLanguage,
            format: 'text'
        };

        // Add source language if provided (helps with accuracy)
        if (sourceLanguage) {
            requestBody.source = sourceLanguage;
        }

        const response = await axios.post(
            `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        if (response.data.data && response.data.data.translations && response.data.data.translations.length > 0) {
            const translatedText = response.data.data.translations[0].translatedText;
            const detectedSourceLanguage = response.data.data.translations[0].detectedSourceLanguage || 'unknown';

            res.json({
                translatedText,
                sourceLanguage: detectedSourceLanguage,
                targetLanguage
            });
        } else {
            res.status(500).json({ error: 'Translation failed - no result' });
        }
    } catch (error) {
        console.error('Translation error:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'Translation failed',
            details: error.response?.data || error.message 
        });
    }
});

// API endpoint to get language preferences for a room
app.get('/api/room-languages/:roomId', (req, res) => {
    const { roomId } = req.params;
    res.json(roomLanguages[roomId] || {});
});

const PORT = process.env.PORT || 8080;
http.listen(PORT, () => {
    console.log(`Signaling server listening on http://localhost:${PORT}`);
    
    // Start ngrok tunnel asynchronously (non-blocking)
    (async () => {
        try {
            // Try npm package first
            const ngrok = require('ngrok');
            await ngrok.authtoken('31RIX1WAuzFyXRRe7DgUp4R5nTF_5PDfX8R78Qxd7Uqx1KaHj');
            const url = await ngrok.connect(PORT);
            console.log('\n========================================');
            console.log('🌐 Public URL (share this with other devices):');
            console.log(`   ${url}`);
            console.log('========================================\n');
        } catch (error) {
            console.log('npm ngrok package failed, trying CLI...');
            // Fallback to CLI
            try {
                const ngrokProcess = spawn('ngrok', [
                    'http',
                    PORT.toString(),
                    '--authtoken',
                    '31RIX1WAuzFyXRRe7DgUp4R5nTF_5PDfX8R78Qxd7Uqx1KaHj'
                ], {
                    stdio: 'ignore', // Don't capture output
                    detached: true   // Don't wait for it
                });
                
                // Handle spawn errors (e.g., ngrok not found) - MUST attach immediately
                // This prevents unhandled error events from crashing the server
                ngrokProcess.on('error', (err) => {
                    console.log('ngrok CLI not found. Server running on localhost only.');
                    console.log('To enable public access, install ngrok: https://ngrok.com/download');
                });
                
                ngrokProcess.unref(); // Allow Node to exit even if ngrok is running
                
                // Wait a bit for ngrok to start, then get the URL from the API
                setTimeout(() => {
                    const httpClient = require('http');
                    const req = httpClient.get('http://127.0.0.1:4040/api/tunnels', (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            try {
                                const tunnels = JSON.parse(data);
                                if (tunnels.tunnels && tunnels.tunnels.length > 0) {
                                    const url = tunnels.tunnels[0].public_url;
                                    console.log('\n========================================');
                                    console.log('🌐 Public URL (share this with other devices):');
                                    console.log(`   ${url}`);
                                    console.log('========================================\n');
                                }
                            } catch (e) {
                                // Silently fail - ngrok might not be running
                            }
                        });
                    });
                    req.on('error', () => {
                        // Silently fail - ngrok might not be running
                    });
                    req.setTimeout(5000, () => {
                        req.destroy();
                    });
                }, 2000);
            } catch (cliError) {
                // Handle synchronous spawn errors (like ENOENT)
                if (cliError.code === 'ENOENT') {
                    console.log('ngrok CLI not found. Server running on localhost only.');
                    console.log('To enable public access, install ngrok: https://ngrok.com/download');
                } else {
                    console.error('Failed to start ngrok (both npm package and CLI):', cliError.message);
                    console.log('Server is still running on localhost only.');
                }
            }
        }
    })().catch((err) => {
        // Catch any unhandled errors in the async function
        console.log('ngrok setup failed. Server running on localhost only.');
        console.log('Error:', err.message);
    });
});


