---
type: reference
status: stable
audience: developer
owner: spectra-runtime-protocol
last_reviewed: 2026-08-09
---

# SPECTRA runtime protocols

This document owns cross-context envelopes, request/response validation, state flow, READY, leases, and configured-site hotkey authority. Per-capability writer selection belongs to [the control architecture](../control/README.md); remote authentication belongs to [remote security](../security/remote-control.md).

## State ownership

| Context | Owns | Must not do |
| --- | --- | --- |
| Popup / Options | intent, local rendering, accessible interaction | predict actual state, write badge/storage, or select executor |
| Content, isolated | document/media identity, DOM/CSS writers, source-keyed state, admitted WebAudio, exact lean-host binding projection | acknowledge stale work, claim Capture before actual ACK, choose a cross-tab hotkey target |
| MAIN bridges | fullscreen audio handoff, exact-element page-media read/write | generic dispatch, domain tables, periodic sync, cross-tab state |
| Background | serialization, settings, `ControlSnapshot`, `AudioSessionSnapshot`, badge, runtime leases, per-document lean/full hotkey transition authority | treat reads as activation, close offscreen outside coordinator |
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

A top-level content sender may submit `source:'hotkey'` through the canonical control intent/operation requests. Background validates the extension sender and binds `origin:'site-page'`, `foreground`, and `target` to the sender's current `tabId+documentId`. This is the required disposition for configured-site lean hotkeys; they never inherit `hotkeyTargetRepository` cross-tab routing.

## Registry v2

UI uses Background registry: `spectra.registry.get/add/remove/query/mark-probed`.
Identity is `site:*`. Legacy `media:v1:*` collapses into site record. Route is `direct | capture`. Snapshot updates UI projection but never activates Capture.

## Processor lifecycle

Only Boost/EQ/Bass/Compressor/Mono/Pan/Delay can request processor (full-output intent). `boostGain: 1–8` is the sole admitted range; no 0-gain substitution or implicit limiting.
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

## READY and built-in cold-document shortcuts

Wire request is `spectra.content.runtime.ensure`. Content ACKs with `runtimeRevision`. READY means full initialization barrier passed.
`spectra.content.default-hotkey.trigger` request carries action (`speed_down`, etc.), press/release, gesture identity, repeat fact. Bootstrap is sole producer for reserved `Alt+*` defaults. Recognized via `window` capture, excluded by configured-site listeners. Background validates before executing action.

Built-in/default shortcuts and configured-site lean shortcuts are intentionally different dispositions:

- built-in defaults may use the Background hotkey-target resolver;
- configured-site lean bindings are site-page invocations and are locked to the sender document.

## Exact configured-site lean protocol

The lean host has exactly one configuration authority:

```text
spectra.content.site-hotkeys.configure
{
  protocolVersion: 2,
  payload: {
    epoch: string,
    generation: non-negative integer,
    bindings: [{ code, modifiers, action }]
  }
}
```

The content host synchronously responds with:

```text
{ accepted: true, epoch, generation }
```

The ACK must echo the exact accepted authority. A Background delivery is classified as:

- **delivered**: exact ACK matched;
- **absent**: Chrome explicitly reports no receiving end;
- **failure**: every other transport/protocol outcome.

`absent` is safe only for the **empty barrier**, because no lean owner exists to clear. After Background successfully injects `content-site-hotkeys.js`, a missing receiver for the nonempty configuration is a failure.

Authority ordering:

1. every `none | lean | full` transition sends an empty exact configuration first;
2. only after that barrier may Background release/ensure a full lease or send a nonempty lean projection;
3. same Worker epoch accepts only increasing generation;
4. different Worker epoch supersedes the old epoch even if generation restarts lower;
5. broad `spectra.hotkeys.changed` events are reconciliation triggers only and are never content-side authority.

Per-document reconciliation is serialized. `forget(tabId, documentId)` retires a lifecycle generation but does not delete an in-flight transition. Async injection/configuration/full-ensure continuations must prove the same lifecycle before publishing. A full capability acquired after retirement is released immediately. Retired lifecycle generation records are removed once no in-flight transition/injection or owned runtime remains.

Lean actions reuse canonical control RPC rather than inventing a second action protocol:

- `speed_up/down` → `spectra.control.intent.submit`, sender-bound hotkey mutation of `speed`;
- `volume_mute` → sender-bound `mediaMuted` toggle intent;
- `volume_up/down` → `spectra.control.operation.submit`, `effective-volume` delta.

Lean repeat coalescing is bounded in content. One admitted operation may finish after key release, but pending repeat pulses never self-drain; keyup/blur/visibility retirement drops them. An invalidated extension context disposes the arbiter so it cannot keep consuming page keys after messaging becomes impossible.

Configured-site bindings still use physical `code`, never queue/mutate KeyboardEvents, and yield to same-event website claims before `preventDefault()`.

## Exact-element page media, native PiP, and fullscreen

- PiP/fullscreen toggle return observed native state.
- `volumeBase`, `mediaMuted`, `speed` use synchronous `page-native -> dom-native` execution targeting one exact media element with paired getter/setter; no domain list, retained player object, observer, timer, or polling loop.
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

A lean configured site may inject the small exact host, but it must not retain the heavy Content Runtime merely because the site has bindings. A later admitted control operation may transiently load existing control writers; that is distinct from a document-lifetime hotkey lease.

## Boundary payloads

Favicon, QR, URL, origin fields validated before use. QR requires complete validated local URL. Terminal origin failures not retried.
