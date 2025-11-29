const express = require('express');
const app = express();
const http = require('http').createServer(app);

const WebSocket = require('ws');
const wss = new WebSocket.Server({ server: http });

const path = require('path');
const { spawn } = require('child_process');

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
                                console.log('ngrok CLI started. Check http://127.0.0.1:4040 for the public URL');
                            }
                        });
                    });
                    req.on('error', () => {
                        console.log('ngrok CLI started. Check http://127.0.0.1:4040 for the public URL');
                    });
                    req.setTimeout(5000, () => {
                        req.destroy();
                        console.log('ngrok CLI started. Check http://127.0.0.1:4040 for the public URL');
                    });
                }, 2000);
            } catch (cliError) {
                console.error('Failed to start ngrok (both npm package and CLI):', cliError.message);
                console.log('Server is still running on localhost only.');
            }
        }
    })();
});


