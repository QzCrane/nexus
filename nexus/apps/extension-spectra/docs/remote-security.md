---
type: reference
status: stable
audience: developer
---

# Authenticated Remote Protocol v2

This document is the sole owner of remote pairing, HMAC authentication,
PeerJS/offscreen session binding and reconnect expiry. Cross-context wire
envelopes remain owned by [protocols.md](./protocols.md); media-control
semantics remain owned by [control-architecture.md](./control-architecture.md).
Do not copy either policy into this security evidence document.

## Trust boundaries

- The Popup may create, inspect, or close a session only for an explicit `tabId`. Closing also requires the matching `sessionId`.
- Background binds a random internal capability to `{tabId, sessionId}`. It accepts command and sync events only from `offscreen.html` with that capability.
- The offscreen host owns PeerJS, pairing secrets, HMAC verification, connection exclusivity, command sequence checks, and reconnect expiry.
- The remote web page receives the secret through a URL fragment. The fragment is not included in the Cloudflare Pages HTTP request and is moved into tab-scoped `sessionStorage` immediately.

## Pairing and authentication

Each session has independent Web Crypto values: 128-bit session ID, 128-bit PeerJS ID component, 128-bit secret, and 128-bit background capability. An unused pairing expires after five minutes.

1. Host accepts a PeerJS data connection but sends no tab state.
2. Host sends `spectra.remote.challenge` with a fresh 256-bit nonce.
3. Controller signs `spectra-remote-v2\n<sessionId>\n<nonce>\n2` with HMAC-SHA-256.
4. Host verifies the proof and sends `spectra.remote.auth-result`.
5. Only then may the host send `spectra.remote.state` or accept `spectra.remote.command`.

Commands carry the exact session ID, a strictly increasing sequence, and the current audio generation. Unknown commands, replays, stale generations, a second controller, and unauthenticated data are rejected. A disconnected authenticated controller has two minutes to reconnect.

## Unified offscreen integration

`src/offscreen-remote/remote-host.ts` exports `createRemoteHostController()` and does not register listeners. The unified `src/offscreen/index.ts` owns integration:

```ts
const remoteHost = createRemoteHostController();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;
  if (message.type === 'OFFSCREEN_HOST_HELLO') {
    sendResponse({
      audioTabs: describeAudioHost(),
      remoteTabs: remoteHost.describeSessions().map(({ tabId, sessionId }) => ({ tabId, sessionId })),
    });
    return false;
  }
  if (message.type.startsWith('REMOTE_HOST_')) {
    return remoteHost.handleRuntimeMessage(message, sendResponse);
  }
  // Delegate remaining messages to the audio host.
});
```

Call `remoteHost.destroy()` during `pagehide`. Background owns the `remote:tab:<tabId>` offscreen lease for the entire session and releases it only after explicit close, tab close, pairing expiry, or reconnect expiry.

## Internal host messages

| Message | Required fields | Result |
| --- | --- | --- |
| `REMOTE_HOST_CREATE_SESSION` | `tabId` | Internal session including capability |
| `REMOTE_HOST_GET_STATUS` | `tabId` | Exact session or `null`; no fallback |
| `REMOTE_HOST_CLOSE_SESSION` | `tabId`, `sessionId` | Closes only an exact match |
| `REMOTE_HOST_SEND_STATE` | `tabId`, `sessionId`, validated state | Sends only to an authenticated connection |
| `REMOTE_HOST_DESCRIBE` | none | Sessions for service-worker recovery |

The host emits capability-bound `REMOTE_HOST_EXECUTE_COMMAND`, `REMOTE_HOST_REQUEST_SYNC`, and `REMOTE_HOST_STATUS_CHANGE`, plus `REMOTE_HOST_SESSION_CLOSED` for lease cleanup.

## Network disclosure

The static controller is served by Cloudflare Pages. PeerJS uses `0.peerjs.com` signaling, Google STUN, and PeerJS TURN relays when necessary. These services may observe IP addresses and connection metadata. After authentication, only the selected tab title/domain and media-control state/commands travel between paired devices; favicon, page content, audio, and video are excluded.
