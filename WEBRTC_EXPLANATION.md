# WebRTC Connection Architecture Explained

## Overview

WebRTC (Web Real-Time Communication) enables direct peer-to-peer communication between two devices. However, it requires a **signaling server** to exchange connection information before the direct connection can be established.

## Architecture Components

### 1. **Signaling Server (WebSocket)**

- **Purpose**: Acts as a message relay between peers before direct connection
- **Technology**: WebSocket (real-time bidirectional communication)
- **Location**: Central server (your Node.js server)
- **What it does**:
  - Manages room/peer matching
  - Relays SDP offers/answers
  - Relays ICE candidates
  - Does NOT handle actual media (audio/video)

### 2. **WebRTC Peer Connection**

- **Purpose**: Direct peer-to-peer connection for media streaming
- **Technology**: RTCPeerConnection API
- **Location**: Browser on each device
- **What it does**:
  - Establishes direct connection between devices
  - Handles audio/video streaming
  - Manages NAT traversal (STUN/TURN servers)

## Connection Flow (Step-by-Step)

### Phase 1: Initial Connection & Room Joining

```
Device A                          Signaling Server                    Device B
   |                                    |                                |
   |--[1] WebSocket Connect------------>|                                |
   |                                    |                                |
   |--[2] Join Room "123"-------------->|                                |
   |                                    |                                |
   |                                    |<-----------[3] WebSocket Connect
   |                                    |                                |
   |                                    |<-----------[4] Join Room "123"
   |                                    |                                |
   |<--[5] Ready (role: caller]--------|                                |
   |                                    |--------[6] Ready (role: callee]-->
```

**What happens:**

1. Both devices connect to the WebSocket server
2. Both send "join" messages with the same room ID
3. Server matches them in the same room
4. When 2 clients are in a room, server sends "ready" messages
5. First client becomes "caller", second becomes "callee"

### Phase 2: WebRTC Setup

#### Step 1: Create Peer Connection

```javascript
// Both devices create RTCPeerConnection
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }, // NAT traversal
  ],
});
```

**What this does:**

- Creates a WebRTC connection object
- Configures STUN servers (for NAT traversal)
- Sets up event handlers for ICE candidates and tracks

#### Step 2: Add Local Media Tracks

```javascript
// Get user's camera/microphone
const stream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true,
});

// Add tracks to peer connection
stream.getTracks().forEach((track) => {
  pc.addTrack(track, stream);
});
```

**What this does:**

- Requests access to camera/microphone
- Adds media tracks to the peer connection
- These tracks will be sent to the remote peer

### Phase 3: SDP Offer/Answer Exchange (via Signaling)

```
Device A (Caller)              Signaling Server              Device B (Callee)
   |                                  |                              |
   |--[1] Create Offer-------------->|                              |
   |                                  |                              |
   |                                  |--------[2] Relay Offer------->|
   |                                  |                              |
   |                                  |<----[3] Create Answer---------|
   |                                  |                              |
   |<--[4] Relay Answer--------------|                              |
```

**What happens:**

1. **Caller creates offer:**

```javascript
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
// Send offer through WebSocket
ws.send(JSON.stringify({ type: "offer", offer }));
```

2. **Signaling server relays offer** to the callee

3. **Callee receives offer and creates answer:**

```javascript
await pc.setRemoteDescription(offer); // Set caller's offer
const answer = await pc.createAnswer();
await pc.setLocalDescription(answer);
// Send answer through WebSocket
ws.send(JSON.stringify({ type: "answer", answer }));
```

4. **Signaling server relays answer** back to caller

5. **Caller sets remote description:**

```javascript
await pc.setRemoteDescription(answer);
```

**What is SDP?**

- **Session Description Protocol** - A text format describing:
  - Media types (audio/video)
  - Codecs supported
  - Network information
  - Connection parameters

### Phase 4: ICE Candidate Exchange (via Signaling)

```
Device A                          Signaling Server                    Device B
   |                                    |                                |
   |--[1] ICE Candidate 1-------------->|                                |
   |                                    |--------[2] Relay Candidate 1-->|
   |                                    |                                |
   |                                    |<----[3] ICE Candidate 1--------|
   |<--[4] Relay Candidate 1------------|                                |
   |                                    |                                |
   |--[5] ICE Candidate 2-------------->|                                |
   |                                    |--------[6] Relay Candidate 2-->|
   |                                    |                                |
   |                                    |<----[7] ICE Candidate 2--------|
   |<--[8] Relay Candidate 2------------|                                |
   |                                    |                                |
   [... multiple candidates exchanged ...]
```

**What happens:**

1. **ICE (Interactive Connectivity Establishment) candidates are generated:**

```javascript
pc.onicecandidate = (event) => {
  if (event.candidate) {
    // Send candidate through WebSocket
    ws.send(
      JSON.stringify({
        type: "candidate",
        candidate: event.candidate,
      })
    );
  }
};
```

2. **Each candidate contains:**

   - IP address and port
   - Protocol (UDP/TCP)
   - Priority
   - Network type (host/relay/srflx)

3. **Both peers exchange candidates** until they find a working path

4. **Candidates are added to peer connection:**

```javascript
await pc.addIceCandidate(candidate);
```

**Why multiple candidates?**

- Devices may have multiple network interfaces (WiFi, cellular, VPN)
- Each interface generates candidates
- WebRTC tries each candidate to find the best path

### Phase 5: Direct Connection Established

```
Device A <==========[Direct P2P Connection]==========> Device B
   |                                                         |
   |<========== Audio/Video Streams ==========>              |
```

**What happens:**

1. **ICE connection state changes:**

   - `new` → `checking` → `connected` → `completed`

2. **Media tracks are received:**

```javascript
pc.ontrack = (event) => {
  // Remote peer's media stream
  remoteVideo.srcObject = event.streams[0];
};
```

3. **Direct peer-to-peer connection is established**
   - No more signaling server needed for media
   - Audio/video flows directly between devices
   - Lower latency, better quality

## Key Concepts

### 1. **Signaling vs. Media**

- **Signaling**: Exchange of connection info (via WebSocket)
- **Media**: Actual audio/video (via WebRTC direct connection)

### 2. **STUN Servers**

- **Purpose**: NAT traversal
- **What they do**: Help discover public IP address
- **Free options**: Google's public STUN servers

### 3. **TURN Servers** (not used in this example)

- **Purpose**: Relay when direct connection fails
- **When needed**: Both devices behind strict NATs/firewalls
- **Cost**: Usually requires paid service

### 4. **SDP (Session Description Protocol)**

- Text-based protocol describing media capabilities
- Contains codec information, network details
- Exchanged during offer/answer phase

### 5. **ICE (Interactive Connectivity Establishment)**

- Protocol for finding the best network path
- Generates multiple candidate paths
- Tests each path to find working connection

## Implementation Checklist

To implement WebRTC elsewhere, you need:

### Server Side (Signaling):

- [ ] WebSocket server (Node.js, Python, etc.)
- [ ] Room/peer matching logic
- [ ] Message relay for: `offer`, `answer`, `candidate`
- [ ] Connection management (cleanup on disconnect)

### Client Side (WebRTC):

- [ ] WebSocket client connection
- [ ] RTCPeerConnection creation
- [ ] Media stream capture (getUserMedia)
- [ ] SDP offer/answer creation and handling
- [ ] ICE candidate generation and exchange
- [ ] Track handling (ontrack event)
- [ ] Connection state monitoring

## Code Structure

### Signaling Server (server.js)

```javascript
// 1. WebSocket server setup
const wss = new WebSocket.Server({ server: http });

// 2. Room management
let rooms = {};

// 3. Handle join messages
wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    if (type === "join") {
      // Add to room, send ready when 2 peers
    }
    if (type === "offer" || type === "answer" || type === "candidate") {
      // Relay to other peer in room
    }
  });
});
```

### Client Side (main.js)

```javascript
// 1. Connect WebSocket
const ws = new WebSocket(wsUrl);

// 2. Create peer connection
const pc = new RTCPeerConnection({ iceServers: [...] });

// 3. Get media and add tracks
const stream = await getUserMedia();
stream.getTracks().forEach(track => pc.addTrack(track, stream));

// 4. Handle ICE candidates
pc.onicecandidate = (event) => {
    ws.send({ type: 'candidate', candidate: event.candidate });
};

// 5. Handle incoming tracks
pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
};

// 6. Create offer/answer
if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send({ type: 'offer', offer });
}
```

## Common Issues & Solutions

1. **Connection fails**: Need TURN servers for strict NATs
2. **No audio/video**: Check getUserMedia permissions
3. **Candidates not working**: Ensure remote description is set before adding candidates
4. **WebSocket messages as Blob**: Handle different message types (string/Blob/ArrayBuffer)

## Security Considerations

- Use HTTPS/WSS in production (required for getUserMedia)
- Validate and sanitize all WebSocket messages
- Implement authentication for rooms
- Rate limit connection attempts
- Use secure STUN/TURN servers

## Next Steps

- Add TURN servers for better connectivity
- Implement reconnection logic
- Add data channels for text chat
- Implement screen sharing
- Add recording capabilities
- Implement multi-party calls (SFU/MCU)
