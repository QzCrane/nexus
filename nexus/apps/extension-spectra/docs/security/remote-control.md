---
type: reference
status: stable
audience: developer
owner: spectra-remote-security
last_reviewed: 2026-07-20
---

# SPECTRA authenticated remote protocol v2

This document is the sole owner of remote pairing, HMAC authentication, PeerJS/offscreen session binding, reconnect expiry, and network disclosure. Cross-context envelopes remain owned by [runtime protocols](../reference/protocols.md); media-control semantics remain owned by [control architecture](../control/README.md).

## Trust boundaries

- Popup creates, inspects, or closes a session only for an explicit `tabId`; closing also requires the matching `sessionId`.
- Background binds a random internal capability to `{tabId, sessionId}` and accepts command/sync events only from `offscreen.html` with that capability.
- The offscreen host owns PeerJS, pairing secrets, HMAC verification, connection exclusivity, command sequences, and reconnect expiry.
- The remote page receives the secret through a URL fragment, which is absent from the Cloudflare Pages HTTP request, and moves it into tab-scoped `sessionStorage` immediately.

## Pairing and authentication

Each session has independent Web Crypto values: 128-bit session ID, 128-bit PeerJS ID component, 128-bit secret, and 128-bit Background capability. An unused pairing expires after five minutes.

1. Host accepts a PeerJS data connection but sends no tab state.
2. Host sends `spectra.remote.challenge` with a fresh 256-bit nonce.
3. Controller signs `spectra-remote-v2\n<sessionId>\n<nonce>\n2` with HMAC-SHA-256.
4. Host verifies the proof and sends `spectra.remote.auth-result`.
5. Only then may the host send `spectra.remote.state` or accept `spectra.remote.command`.

Commands carry the exact session ID, a strictly increasing sequence, and current audio generation. Unknown commands, replays, stale generations, a second controller, and unauthenticated data are rejected. A disconnected authenticated controller has two minutes to reconnect.

## Unified offscreen integration

`src/offscreen-remote/remote-host.ts` exports `createRemoteHostController()` and does not register global listeners. Unified `src/offscreen/index.ts` owns integration and delegates exact message families.

Call `remoteHost.destroy()` during `pagehide`. Background owns the remote offscreen lease for the entire session and releases it only after explicit close, tab close, pairing expiry, or reconnect expiry.

## Internal host messages

| Message | Required fields | Result |
| --- | --- | --- |
| `REMOTE_HOST_CREATE_SESSION` | `tabId` | internal session including capability |
| `REMOTE_HOST_GET_STATUS` | `tabId` | exact session or `null`; no fallback |
| `REMOTE_HOST_CLOSE_SESSION` | `tabId`, `sessionId` | closes only an exact match |
| `REMOTE_HOST_SEND_STATE` | `tabId`, `sessionId`, validated state | sends only to an authenticated connection |
| `REMOTE_HOST_DESCRIBE` | none | sessions for service-worker recovery |

The host emits capability-bound execute, sync, status, and closed events so Background can validate command ownership and clean leases.

## Network disclosure

The static controller is served by Cloudflare Pages. PeerJS uses `0.peerjs.com` signaling, Google STUN, and PeerJS TURN relays when necessary. These services may observe IP addresses and connection metadata. After authentication, only selected-tab title/domain and media-control state/commands travel between paired devices; favicon, page content, browsing history, audio, and video are excluded.

Any provider, endpoint, retention, or transmitted-field change updates this document, the privacy policy, permission/data-use declarations, remote-site CSP and disclosure, store copy, tests, and release gate in one change.