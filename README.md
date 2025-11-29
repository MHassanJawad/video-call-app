## Two-Person WebRTC Video Call (Phase One)

This project implements a minimal two-person WebRTC video call with a WebSocket-based signaling server, following the provided machine-interpretable plan for Phase One.

### Run Instructions

1. Install dependencies:

```bash
npm install
```

2. Start the signaling server (which also serves the static frontend):

```bash
npm start
```

3. Open the app in a browser at:

```text
http://localhost:8080
```

4. In **two separate browser windows or devices**:

- Enter the same room ID (e.g. `123`)
- Click **Join**

Both clients will:

- Send `"join"` to the signaling server
- Receive `"ready"` when two participants are present
- Perform the offer/answer and ICE candidate exchange
- Establish a direct WebRTC connection for audio/video

### Notes

- For local development, the client uses `ws://` with `localhost`.
- For production behind HTTPS, the WebSocket URL automatically switches to `wss://` based on `window.location.protocol`.
# video-call-app
