---
type: reference
status: stable
audience: contributor
owner: spectra-store-copy
last_reviewed: 2026-07-20
---

# SPECTRA Chrome Web Store privacy declarations

This file must match the submitted manifest, production package, [`../PRIVACY.md`](../PRIVACY.md), remote-site deployment, and actual network behavior. The optional remote creates outbound connections and exchanges selected-tab metadata after authentication, so do not claim that the product never transmits data.

## Single purpose

```text
SPECTRA enhances audio and video playback with volume amplification, equalizer, playback and video controls, and an optional authenticated mobile remote.
```

## Permission justifications

### `tabs`

```text
Required to bind settings and remote-control sessions to the exact user-selected tab, clean up state when a tab closes or navigates, and update that tab's badge. When the user explicitly enables the mobile remote, the selected tab's title and domain are sent only to the authenticated paired device.
```

### `webNavigation`

```text
Required to distinguish a top-level document navigation from same-document navigation so SPECTRA can invalidate document identity and release audio or remote state only when appropriate. Navigation events are processed locally and are not uploaded to the developer.
```

### `storage`

```text
Required to save volume, equalizer, playback, appearance, hotkey, and per-site preferences locally. Active remote pairing secrets are not placed in persistent extension storage.
```

### `alarms`

```text
Required for bounded lifecycle work that must survive Manifest V3 service-worker suspension, including the one-shot offscreen shutdown grace period. It is not used for analytics or an unbounded polling loop.
```

### `downloads`

```text
Required only to save user-initiated screenshot captures of the current visible tab as PNG files in the user's Downloads directory under a spectra/ subfolder. SPECTRA listens for the download completion event solely to acknowledge the screenshot operation; it does not read, upload, or modify any other downloaded file, history, or path.
```

### `tabCapture`

```text
Required only when an admitted full-output audio feature needs to process the current active tab locally. A new Capture can start only from a Popup or browser command invocation for that same active tab; page activity, restore, remote control, warm update, and alternate background-tab shortcuts cannot start it. SPECTRA does not record or upload captured audio.
```

### `offscreen`

```text
Required for the Manifest V3 offscreen document that owns continuous local Capture processing and optional authenticated PeerJS WebRTC sessions while the Popup is closed.
```

### host permissions

```text
Required to detect and control media elements on pages where the user invokes SPECTRA and to maintain document-scoped media identity. Page content and media are processed locally. The optional remote sends only the selected tab's title, domain, and media-control state to the authenticated paired device; it does not send page content, favicons, audio, or video.
```

### `userScripts`

```text
Required only for user-authored custom hotkey scripts that the user explicitly configures and triggers through Chrome's userScripts sandbox.
```

### `scripting`

```text
Required to install locally bundled media-control code in the active page and to execute bounded browser-supported operations. It is not used to download or execute remote extension code.
```

### `favicon`

```text
Required to resolve website icons in the Popup through Chromium's extension-owned _favicon endpoint so that page CSP, remote icon hosts, or chrome://favicon URLs cannot erase or spoof tab identity. SPECTRA requests only the page URL and a rendered size; no other favicon data, history, or visit evidence is read or transmitted.
```

## Remote code declaration

```text
The extension does not execute remotely hosted JavaScript or WebAssembly. PeerJS, QR generation, and extension logic are bundled in the submitted package. The separately hosted mobile remote also serves a pinned local PeerJS bundle and applies a Content Security Policy that disallows third-party scripts.
```

## Data-use declaration

Use the Chrome Web Store's current categories and wording rather than copying historical checkbox labels. The declaration must communicate that:

- the optional remote is user-started and off by default;
- after HMAC authentication, the selected tab's title, domain, and media-control state are exchanged with the paired device for app functionality;
- Cloudflare Pages, PeerJS signaling, STUN, and TURN providers may process IP addresses and connection metadata;
- SPECTRA does not sell data or use it for advertising, analytics, credit decisions, or behavioral personalization;
- page content, favicons, audio, and video are not sent through the remote channel;
- the developer does not operate a server that receives remote state or commands.

Do not select a “no collection or transmission” declaration when its official definition conflicts with this remote data flow.

## Network disclosure text

```text
The optional remote is served by Cloudflare Pages and uses PeerJS signaling at 0.peerjs.com, Google STUN, and PeerJS TURN when direct WebRTC connectivity is unavailable. These providers may process IP addresses and connection metadata. After an HMAC-SHA-256 pairing challenge succeeds, the selected tab's title, domain, and media-control state are sent over WebRTC to the paired device. Commands return over the same authenticated channel. SPECTRA does not transmit page content, favicons, audio, or video, and the developer does not operate a server that receives remote state or commands.
```

## Publication gate

Before each release, compare this file with:

1. the exact submitted manifest permissions;
2. production network destinations and CSP;
3. remote protocol fields and retention;
4. the public privacy-policy URL;
5. every localized store description.

Any difference blocks publication until code, permission, or disclosure is reconciled.
