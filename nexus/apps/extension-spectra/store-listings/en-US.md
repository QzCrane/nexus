# SPECTRA - Chrome Web Store (English)

## Name

SPECTRA - Volume Booster, EQ & Media Control

## Summary (Max 132 chars)

Boost volume up to 800%, use a 10-band EQ, control media and video, and pair an optional authenticated phone remote.

## Detailed Description

SPECTRA brings audio, playback, and video controls into one Chrome extension while keeping settings and media processing local by default.

### Audio controls

- Volume control up to 800%
- 10-band equalizer from 32 Hz to 16 kHz
- Bass, compressor, mono, stereo balance, and delay controls
- Separate media-mute and browser tab-mute state

High amplification can distort audio or produce unsafe listening levels. Increase volume gradually and use the compressor only when it fits your source and listening setup.

### Playback and video

- Playback speed, play/pause, seek, loop, markers, and A/B loop
- Video rotation, mirroring, fill, filters, and background dimming
- Picture-in-Picture and fullscreen through standard browser behavior
- Visible-frame screenshots when the current page and media allow capture

Availability depends on the page, media element, browser support, permissions, and user-activation rules. SPECTRA reports an unsupported operation instead of promising the same result on every website.

### Optional phone remote

Create a pairing session and scan its QR code to use a phone as a remote. The controller must pass an HMAC-SHA-256 authentication challenge before it receives state or can send commands.

The remote is off by default. When enabled, it uses Cloudflare Pages, PeerJS signaling, STUN, and TURN services. After authentication, the selected tab's title, domain, and media-control state may be exchanged with the paired device. Page content, favicons, audio, and video are not sent through the remote channel.

### Settings and hotkeys

- Local global and per-site preferences
- Configurable media-control hotkeys
- Translated product surfaces
- Acknowledged state shared by the extension Popup and authenticated remote

### Privacy

SPECTRA has no advertising, analytics, telemetry, or developer-operated collection service. Settings and media processing stay on the device by default. Optional remote networking is described above and in the privacy policy.

SPECTRA does not bypass browser security, permissions, protected-content restrictions, or user-activation requirements.
