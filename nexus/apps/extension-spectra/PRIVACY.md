# Privacy Policy for SPECTRA

**Last Updated: July 15, 2026**

## Overview

SPECTRA is a browser extension for audio and video playback controls. SPECTRA has no analytics, advertising, telemetry, or developer-operated data collection service. Most processing and all saved settings remain on the user's device.

The optional mobile remote feature necessarily uses third-party network services. This section describes that traffic precisely.

## Data Kept on the Device

Volume, equalizer, playback, appearance, hotkey, and per-site preferences are stored with Chrome's local extension storage. SPECTRA does not upload those settings to the developer.

Audio and video content is processed locally. SPECTRA does not record or upload media content.

## Optional Mobile Remote

The remote feature is off by default and starts only when the user creates a pairing session. When enabled:

- Cloudflare Pages serves the static remote-control website.
- `0.peerjs.com` exchanges PeerJS signaling messages needed to establish WebRTC.
- Google's public STUN service helps the two devices discover a direct network path.
- PeerJS TURN servers may relay encrypted WebRTC packets when a direct path cannot be established.
- After authentication, the extension sends the controlled tab's title, domain, volume, mute, play/pause, and playback-speed state to the paired device. The paired device sends allowlisted media commands back.

Cloudflare, PeerJS, the STUN provider, and a TURN relay can receive ordinary network metadata such as IP addresses and connection timing. A TURN server can relay encrypted WebRTC packets but does not receive the pairing secret. Their handling and retention of network logs are governed by their own policies.

SPECTRA does not send favicons, page content, browsing history, audio, or video through the remote channel.

## Remote Security and Retention

- Each session uses independent 128-bit random session, peer, and secret values.
- The secret is placed in the URL fragment, which is not sent in the HTTP request to Cloudflare Pages.
- The controller must complete an HMAC-SHA-256 challenge before it receives tab state or can send commands.
- An unused pairing expires after five minutes. An authenticated session has a two-minute reconnect window after disconnection.
- Only one authenticated controller is accepted per session, and every command is bound to the selected tab, session, generation, and monotonic sequence.
- Pairing data is held in extension memory for the active session and in the remote page's `sessionStorage` for that browser tab. It is destroyed when the session is closed or expires; the remote page also offers a "Forget saved pairing" action.

## Data We Do Not Collect

SPECTRA does not collect or sell personal information, browsing history, media content, location, analytics identifiers, or advertising profiles. The developer does not operate a server that receives remote-control state or commands.

## Changes to This Policy

Policy changes will be reflected in this file and its "Last Updated" date.

## Contact

For privacy questions, open an issue on the SPECTRA support page.
