---
type: reference
status: stable
audience: developer
owner: spectra-runtime-protocol
last_reviewed: 2026-07-24
---

# SPECTRA runtime protocols

This document owns cross-context envelopes, request/response validation, state flow, READY, and leases. Per-capability writer selection belongs to [the control architecture](../control/README.md); remote authentication belongs to [remote security](../security/remote-control.md).

## State ownership

| Context | Owns | Must not do |
| --- | --- | --- |
| Popup / Options | intent, local rendering, accessible interaction | predict actual state, write badge/storage, or select executor |
| Content, isolated | document/media identity, DOM/CSS writers, source-keyed state, admitted WebAudio | acknowledge stale work, claim Capture before actual ACK |
| MAIN bridges | fullscreen audio handoff, exact-element page-media read/write | generic dispatch, domain tables, periodic sync, cross-tab state |
| Background | serialization, settings, `ControlSnapshot`, `AudioSessionSnapshot`, badge, leases | treat reads as activation, close offscreen outside coordinator |
| Unified offscreen | actual Capture processors, authenticated remote sessions | create/close its own document, infer Background lease |

`ControlSnapshot` is the sole actual source for 51 control capabilities and active identities. `AudioSessionSnapshot` owns processor lifecycle only.

## Protocol v2 envelope

Mapped contract in `@nexus/contracts`:
Request: `{ protocolVersion, requestId, tabId?, documentId?, generation?, type, payload }`
Response: `{ ok: true, data }` or `{ ok: false, error: { code, message, retryable } }`

Runtime guards validate request type, payload, sender context, and identity. Narrow v1 adapters exist only for rolling compatibility. Listeners own exact request-type sets (no prefix matching).

## Control transaction

```text
intent (observation/Popup/remote/hotkey)
  → Background orders document generation/field revision
  → Background optionally admits current-tab Capture for this invocation
  → Least-invasive admitted writer executes once
  → Readback proves actual state
  → Background commits ControlSnapshot
  → UI contexts consume projections
```

Candidate return is not an ACK. Only readback with current `tabId+documentId+origin+generation+revision` can commit. Failed fields roll back optimistic projection.
Verified page observations bypass the writer stage, commit `controlled:false`, and never echo writes to Content.
Heavy-runtime observation carries exact `MediaTarget`. Bootstrap may send `target:null` only for `volumeBase+mediaMuted` or `speed+preservePitch` groups, which Background accepts only after initialization barrier.
Reads do not acquire WebAudio/Capture/MAIN/offscreen. Page-media reads may synchronously use exact-element page bridge before DOM fallback.

`ControlSubmitRequest` never carries Capture authority. Background adds `captureAdmission: 'extension-invocation'` to internal `ControlIntent` only after confirming valid current-tab Popup/shortcut. Value is consumed by policy, not saved in snapshot.

## Registry v2

UI uses Background registry: `spectra.registry.get/add/remove/query/mark-probed`.
Identity is `site:*`. Legacy `media:v1:*` collapses into site record. Route is `direct | capture`. Snapshot updates UI projection but never activates Capture.

## Processor lifecycle

Only Boost/EQ/Bass/Compressor/Mono/Pan/Delay can request processor (full-output intent).
Transition binds document identity, generation, and revision:
1. ACK stable old route at unity.
2. Build candidate behind closed gate.
3. Verify actual configuration, graph signature, source coverage, context.
4. Switch gates, commit active.
5. Release old route (or restore on failure).

No sample-synchronous crossfade; bounded unity handoff without double processing.

## Runtime and offscreen leases

Passive bootstrap performs bounded getters + two capture-phase media listeners (enabled after HELLO barrier). Disposed when heavy-runtime exists.
Heavy Content ownership is tokenized by document/consumer. Final token releases work. Reads create no token.
Background serializes `offscreen.html` creation, reconstructs via HELLO, owns `audio/remote` leases. Closes offscreen after grace period.

## READY and cold-document shortcuts

Wire request is `spectra.content.runtime.ensure`. Content ACKs with `runtimeRevision`. READY means full initialization barrier passed.
`spectra.content.default-hotkey.trigger` request carries action (`speed_down`, etc.), press/release, gesture identity, repeat fact. Bootstrap is sole producer for reserved `Alt+*` defaults. Recognized via `window` capture, excluded by heavy site listener. Background validates before executing action.
Accepted configured-site gestures release through Bootstrap's stable keyup capture observer. Physical `code` only, never queued/mutated. Keyups/exits discard unconsumed site repeat batches.

## Exact-element page media, native PiP, and fullscreen

- PiP/fullscreen toggle return observed native state.
- `volumeBase`, `mediaMuted`, `speed` use synchronous `page-native -> dom-native` execution targeting one exact media element with paired getter/setter. No domain lists or polling.
- Native events during pending write are correlated ACK evidence. Later page events read through selected writer before committing.

## Privileged boundaries

- page-native MAIN: limited to exact media element + paired getter/setter.
- trusted hotkeys: invoke native APIs within trusted stack.
- starting Capture: requires Background's volatile current-tab extension-invocation admission.
- user scripts: explicit permission + sandbox.
- URL open: HTTP(S) only.
- remote: HMAC authentication, bound to session/tab/generation/sequence.

## Performance boundaries

Default pages have no extension AudioContext, offscreen document, analyser, or periodic work. Continuous UI values coalesce; visualizers use generation-aware leases and bounded sampling from active processors.

## Boundary payloads

Favicon, QR, URL, origin fields validated before use. QR requires complete validated local URL. Terminal origin failures not retried.
