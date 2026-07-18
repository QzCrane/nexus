# SPECTRA

🎵 **Professional Media Controller** - Chrome Extension for Audio/Video Enhancement

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Web%20Store-4285F4?logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

### 🔊 Audio Enhancement

- **800% Volume Boost** - Amplify any audio beyond browser limits
- **10-Band Equalizer** - Fine-tune your sound
- **Compressor** - Prevent distortion at high volumes
- **Bass Boost** - Enhanced low frequencies
- **Pan Control** - Adjust left/right balance
- **Audio Delay** - Sync audio with video (0–500ms)

### 🎬 Video Control

- **Speed 0.1x - 16x** - Precise playback rate control
- **Rotate/Mirror** - Transform video orientation
- **Picture-in-Picture** - Floating video window
- **Screenshot** - Capture video frames
- **Background Dim** - Focus on video content
- **AB Loop** - Repeat any section

### 📱 Remote Control

- **Phone Remote** - Control from your mobile device
- **QR Code Connection** - Easy pairing via WebRTC
- **Multi-Session** - Manage multiple tabs

### ⚙️ Settings

- **Per-Site Presets** - Save settings for each domain
- **Custom Hotkeys** - Configure keyboard shortcuts
- **Multi-Language** - EN/中文/日本語/한국어/ES/FR/DE/RU

## Installation

### Chrome Web Store (Recommended)

[Install from Chrome Web Store](https://chrome.google.com/webstore)

### Manual Installation

1. Download the latest release
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist` folder

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Development mode
bun run dev
```

## Engineering documentation

- [Control architecture](docs/control-architecture.md) — the single owner for
  media, audio, video, site adapters and remote-control behavior.
- [Runtime protocols](docs/protocols.md) — v2 messages, ACK/Snapshot projection,
  READY, leases, Toast and native PiP/fullscreen lifecycle.
- [Architecture](docs/architecture.md) — context ownership, route cache and
  processor lifecycle boundaries.
- [Development sync 2026-07-19](docs/development-sync-2026-07-19.md) — the
  implementation summary for the current main branch.
- [Regression recovery 2026-07-18](docs/regression-recovery-2026-07-18.md) —
  historical baseline plus current verification status.

## Tech Stack

- **Manifest V3** - Modern Chrome extension architecture
- **TypeScript** - Type-safe codebase
- **WebAudio API** - Professional audio processing
- **WebRTC** - Peer-to-peer remote control
- **Monorepo** - Bun + Turborepo

## Privacy

- **Zero Telemetry** - No analytics, advertising, or developer-operated collection
- **Local by Default** - Settings and media processing stay on your device
- **Transparent Remote Networking** - Optional remote pairing uses Cloudflare Pages and PeerJS WebRTC infrastructure as documented
- **Minimal Permissions** - Only what's needed
- [Privacy Policy](PRIVACY.md)

## License

MIT License - see [LICENSE](../../LICENSE)

## Contributing

Contributions are welcome! Please read our contributing guidelines first.

---

Made with ❤️ by [QzCrane](https://github.com/QzCrane)
