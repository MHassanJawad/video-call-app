const express = require('express');
const app = express();
const http = require('http').createServer(app);

const WebSocket = require('ws');
const wss = new WebSocket.Server({ server: http });

const path = require('path');

// Serve static frontend files from public directory
app.use(express.static(path.join(__dirname, 'public')));

let rooms = {};

wss.on('connection', (ws) => {
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

            if (rooms[room].length === 2) {
                // First joined becomes caller, second becomes callee
                rooms[room].forEach((client, index) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'ready',
                            role: index === 0 ? 'caller' : 'callee'
                        }));
                    }
                });
            }
            return;
        }

        if (['offer', 'answer', 'candidate'].includes(type)) {
            const roomId = ws.room;
            if (!roomId || !rooms[roomId]) return;
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

const PORT = process.env.PORT || 8080;
http.listen(PORT, () => {
    console.log(`Signaling server listening on http://localhost:${PORT}`);
});


