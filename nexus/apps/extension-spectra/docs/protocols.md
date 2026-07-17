# SPECTRA runtime protocols

This document owns cross-context state and message flow. Per-capability writer
selection remains exclusively in [control-architecture.md](./control-architecture.md).

## State ownership

| Context | Owns | Must not do |
| --- | --- | --- |
| Popup / Options | intent, immediate local rendering and accessibility | predict actual state, write badge/storage or choose an executor |
| Content (ISOLATED) | document/media identity, DOM/CSS writers, source-keyed state and admitted Media WebAudio | acknowledge stale work or claim Capture before its actual ACK |
| MAIN one-shot adapter | one allowlisted official player setter/getter after typed native failure | install a runtime, listener, patch or cross-world message bridge |
| Background | serialized coordinator, settings repository, `ControlSnapshot`, `AudioSessionSnapshot`, badge and leases | treat reads as activation or close offscreen outside its coordinator |
| Unified offscreen host | actual Capture processors and authenticated PeerJS sessions | create/close its own document or infer a Background lease |

`ControlSnapshot` is the only actual source for the 50 control capabilities and
for `activeMedia` / `activeVideo`. `AudioSessionSnapshot` owns processor
lifecycle only. UI and remote code never use audio-session config to overwrite
control fields.

## Protocol v2

All current requests use the mapped contracts in `@nexus/contracts`:

```text
{ protocolVersion, requestId, tabId?, documentId?, generation?, type, payload }
```

Responses are exactly one of:

```text
{ ok: true, data }
{ ok: false, error: { code, message, retryable } }
```

Runtime guards validate request type, payload, sender context and
request-specific response data. The narrow v1 adapter supports already-loaded
1.3.4 contexts for one store cycle; current clients send only v2.

## Control transaction

```text
page event / Popup / remote / hotkey intent
  -> Background coordinator orders document generation + revision
  -> least-invasive admitted writer executes once
  -> event/getter, computed owner, processor or Chrome readback
  -> coordinator commits ControlSnapshot
  -> Popup, authenticated remote and badge receive one projection
```

Page observations bypass the writer stage: verified native events commit
`controlled:false` actual state and are never echoed back to Content. Reads do
not acquire processing, MAIN or offscreen work.

## Processor lifecycle

Only Boost/EQ/Bass/Compressor/Mono/Pan/Delay can request a processor, and only
with explicit full-output intent. Complete safe media coverage admits one lazy
Media WebAudio graph; otherwise authorized Capture may own opaque full output.
The processor contract exposes `boostGain: 1–8` and DSP parameters only. Page
volume, media mute, speed and transport cannot cross that boundary.

A transition uses current `documentId + generation + controlRevision`:

1. acknowledge the stable old route at unity;
2. create the candidate behind a closed gate;
3. verify normalized actual config, graph signature and running context;
4. switch gates and commit `active`;
5. release the old route; or restore it if the candidate fails.

This prevents double DSP and premature ACK. Media WebAudio and `tabCapture` do
not share a sample clock, so the protocol promises a bounded unity handoff, not
sample-synchronous crossfade.

## Runtime and offscreen leases

The passive top-level bootstrap performs only bounded one-shot getters. Heavy
Content runtime ownership is tokenized by document and consumer; the final
control/restore/hotkey/Popup/remote/source token releases listeners and owned
work. A status GET never creates a token.

One `offscreen.html` hosts Capture and remote sessions. Background serializes
creation, reconciles actual host state through HELLO after worker restart, and
owns `audio:<tabId>` / `remote:<sessionId>` leases. A one-shot Chrome alarm
closes the host 30 seconds after the last lease disappears. Feature modules
never call `createDocument()` or `closeDocument()` directly.

## Privileged boundaries

- Site-native MAIN execution is one allowlisted official API call with stable
  getter readback; it cannot bypass activation, CORS, DRM or document identity.
- Trusted page hotkeys invoke play/PiP/fullscreen inside the trusted event stack
  and submit only observed actual state afterward.
- `run-user-script` requires explicit `userScripts` permission and stays in the
  `USER_SCRIPT` sandbox.
- `open-url` accepts only HTTP(S).
- Remote state and commands remain unavailable until HMAC authentication, then
  stay bound to fixed session/tab/generation/sequence values.

## Performance boundaries

Default pages have no extension AudioContext, offscreen document, analyser or
periodic task. UI continuous values coalesce to at most 20 IPC writes per
second; persistence uses a 250 ms trailing write. Visualizer consumers use
generation-aware leases, one in-flight batch and at most 15 Hz sampling from an
already-active processor. Hidden/non-intersecting consumers release their own
lease immediately.
