---
type: reference
status: stable
audience: user
owner: spectra-privacy
last_reviewed: 2026-11-01
---

# Privacy Policy for SPECTRA

**Last updated: November 1, 2026**

## Overview

SPECTRA is a browser extension for audio, video, and playback controls. It has no advertising, analytics, telemetry, or developer-operated data collection service. Settings and media processing remain on the user's device by default.

The optional mobile remote is a separate, user-started network capability. It necessarily uses third-party network infrastructure described below.

## Data kept on the device

Volume, equalizer, playback, appearance, hotkey, and per-site preferences are stored in Chrome extension storage. SPECTRA does not upload these settings to the developer.

Audio and video content is processed locally. SPECTRA does not record or upload media content.

Chrome grants SPECTRA temporary `activeTab` access only after the user invokes the extension action or a registered browser command. SPECTRA uses that temporary authority with `tabCapture` only to start local audio processing for the same active page, including volume above 100%, audio effects, or an enabled foreground spectrum. The grant is not persisted, and captured audio is not recorded or transmitted.

## Local diagnostic export

SPECTRA can write a diagnostic file, but only when the user presses the export
button in Options. Nothing is collected before that press: there is no telemetry
timer, no background collection loop, no remote endpoint, and no developer server
on the receiving side. The file is saved through Chrome's ordinary download path
and stays on the device unless the user chooses to share it.

The file contains the extension version, the Chromium major version, the names of
granted permissions, how many origin patterns are granted plus whether a broad
grant such as `<all_urls>` is present, counts per extension context type, aggregate
counters about SPECTRA's own in-memory state (such as how many tabs are audible or
how many runtime loads are in flight), and at most 64 recent internal event codes.

The file does not contain page addresses or titles, tab, window, document or
request identifiers, storage contents, media content, browsing history, or account
data. Because it is a file the user owns, what happens to it after the download is
outside the extension's control.

## Optional mobile remote

The remote is off by default and starts only when the user creates a pairing session. When enabled:

- Cloudflare Pages serves the static remote-control page.
- `0.peerjs.com` exchanges PeerJS signaling messages needed to establish WebRTC.
- Google's public STUN service helps the devices discover a network path.
- PeerJS TURN infrastructure may relay encrypted WebRTC packets when a direct path is unavailable.
- After authentication, the selected tab's title, domain, and media-control state may be exchanged with the paired device. The paired device may send allowlisted media commands back.

Cloudflare, PeerJS, STUN, and TURN providers can receive ordinary network metadata such as IP addresses, connection timing, and relay usage. Their handling and retention of logs are governed by their own policies. A TURN service can relay encrypted packets but does not receive the fragment pairing secret.

SPECTRA does not send favicons, page content, browsing-history lists, audio, or video through the remote channel.

## Remote security and retention

- Each session uses independent random session, peer, secret, and internal capability values.
- The pairing secret is placed in the URL fragment, which is not included in the HTTP request to Cloudflare Pages.
- The controller must complete an HMAC-SHA-256 challenge before it receives state or can send commands.
- An unused pairing expires after five minutes. An authenticated controller has a two-minute reconnect window after disconnection.
- Only one authenticated controller is accepted per session. Commands are bound to the selected tab, session, generation, and monotonic sequence.
- Active pairing data is kept in extension runtime state and in the remote page's tab-scoped `sessionStorage`. It is removed when the session is closed or expires; the remote page also provides a forget action.

## Data SPECTRA does not collect

SPECTRA does not collect or sell personal information, browsing-history lists, media content, location, analytics identifiers, or advertising profiles. The developer does not operate a server that receives remote-control state or commands.

This statement does not mean that no network metadata exists: the optional remote uses the third-party services named above.

## Policy changes

Changes are reflected in this file and its “Last updated” date. A release that changes permissions, network destinations, transmitted fields, retention, or remote authentication must update this policy before publication.

## Contact

For privacy questions, use the support channel linked from the published SPECTRA listing or repository.
