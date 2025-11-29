## Two-Person WebRTC Video Call with Speech Translation

This project implements a two-person WebRTC video call with real-time speech-to-text and translation capabilities. It uses Google Cloud Speech-to-Text API for automatic language detection and Google Cloud Translation API for real-time translation.

### Features

- ✅ WebRTC video/audio calling
- ✅ Real-time speech-to-text transcription
- ✅ Automatic language detection
- ✅ Real-time translation between languages
- ✅ Display translated text overlay on video

### Setup Instructions

1. **Install dependencies:**

```bash
npm install
```

2. **Configure environment variables:**

Create a `.env` file in the root directory with the following variables:

```env
# Google Cloud API Key (required for speech-to-text and translation)
GOOGLE_CLOUD_API_KEY=your-google-cloud-api-key

# Server Settings
PORT=3000
SIGNALING_PORT=3001

# Optional: NextAuth Configuration
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-key

# Optional: Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

**Note:** You need a Google Cloud API key with the following APIs enabled:
- Cloud Speech-to-Text API
- Cloud Translation API

3. **Start the server:**

```bash
npm start
```

4. **Open the app in a browser:**

```text
http://localhost:3000
```

### Usage

1. **Create or Join a Room:**
   - Create a new room or join an existing one using a room ID
   - Share the room ID with the other participant

2. **Enable Translation:**
   - Once connected, use the "Language Settings" panel
   - Select your target language (the language you want translations in)
   - Make sure "Enable Speech Translation" is checked

3. **How It Works:**
   - Your speech is automatically captured and transcribed
   - The system detects your language automatically
   - Your speech is translated to the target language
   - The translated text appears on the other person's screen
   - Their speech is translated to your target language and shown on your screen

### Supported Languages

The system supports automatic detection and translation for:
- English (en)
- Spanish (es)
- French (fr)
- German (de)
- Italian (it)
- Portuguese (pt)
- Japanese (ja)
- Korean (ko)
- Chinese (zh)
- Arabic (ar)
- Hindi (hi)
- Russian (ru)
- Dutch (nl)

### Technical Details

- **Speech-to-Text:** Audio is captured in 3-second chunks and sent to Google Cloud Speech-to-Text API
- **Language Detection:** Automatically detects the spoken language from a list of supported languages
- **Translation:** Text is translated using Google Cloud Translation API
- **Real-time Display:** Translated text appears as an overlay on the video feed

### Notes

- For local development, the client uses `ws://` with `localhost`
- For production behind HTTPS, the WebSocket URL automatically switches to `wss://` based on `window.location.protocol`
- Audio is processed in chunks to minimize latency
- Translation requires an active internet connection and valid Google Cloud API key
