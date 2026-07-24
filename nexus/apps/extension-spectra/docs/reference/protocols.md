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
| Popup / Options | intent, immediate local rendering, accessibility | predict actual state, write badge/storage, or select an executor |
| Content, isolated world | document/media identity, DOM/CSS writers, source-keyed state, admitted Media WebAudio | acknowledge stale work or claim Capture before actual ACK |
| MAIN versioned bridges | fullscreen audio handoff and synchronous exact-element page-media read/write | generic dispatch, domain tables, periodic player synchronization, settings, or cross-tab state |
| Background | serialization, settings repository, `ControlSnapshot`, `AudioSessionSnapshot`, badge, and leases | treat reads as activation or close offscreen outside its coordinator |
| Unified offscreen host | actual Capture processors and authenticated remote sessions | create/close its own document or infer a Background lease |

`ControlSnapshot` is the sole actual source for all **51 control capabilities** and independent `activeMedia` / `activeVideo` identities. `AudioSessionSnapshot` owns processor lifecycle only. UI and remote code never copy audio-session configuration over control fields.

## Protocol v2 envelope

Every current request uses the mapped contract in `@nexus/contracts`:

```text
{ protocolVersion, requestId, tabId?, documentId?, generation?, type, payload }
```

Every response is exactly one of:

```text
{ ok: true, data }
{ ok: false, error: { code, message, retryable } }
```

Runtime guards validate request type, payload, sender context, identity, and request-specific response data. Narrow v1 adapters exist only for explicitly supported rolling compatibility; current clients send v2.

Each `chrome.runtime.onMessage` listener owns an exact request-type set. Prefix similarity is not ownership: a listener returns `false` before validation when another handler owns the type.

## Control transaction

```text
page observation / Popup / authenticated remote / hotkey intent
  → Background orders document generation and field revision
  → Background optionally admits current-tab Capture for this invocation only
  → the least-invasive admitted writer executes once
  → event/getter/Chrome/processor readback proves actual state
  → Background commits ControlSnapshot
  → Popup, authenticated remote, badge, and feedback consume projections
```

A candidate returned by an executor is not an ACK. Only readback carrying current `tabId + documentId + origin + generation + revision` can commit. A failed field rolls back its optimistic projection without discarding unrelated successful fields.

Verified page observations bypass the writer stage, commit `controlled:false`, and never echo a second write to Content. A heavy-runtime observation carries its exact `MediaTarget`. Before that runtime exists, the top-level bootstrap may instead send `target:null`, but only for a complete `volumeBase + mediaMuted` and/or `speed + preservePitch` group, with exact native strategy provenance and the browser sender's current document identity. Background waits for the initialization barrier before accepting that targetless form, so page-load defaults cannot overwrite a same-origin session before it is rebound. Reads do not acquire Media WebAudio, Capture, a generic MAIN runtime, or an offscreen lease. For `volumeBase`, `mediaMuted`, and `speed`, a read may synchronously use the already-installed exact-element page bridge before falling back to the ordinary DOM getter.

`ControlSubmitRequest` never carries Capture authority. Background may add the
literal `captureAdmission: 'extension-invocation'` only to the internal
`ControlIntent` after confirming that a Popup or identity-validated shortcut
transaction still targets the active tab. A page shortcut must come from the
current top-level HTTP(S) document, and Background rechecks its exact
`documentId` before admission. The value is consumed by that policy application,
is absent from snapshots/session/handoff state, and is not available to
arbitrary page state, restore, remote, navigation, media lifecycle, or
alternate-tab routing.
The canonical protocol guard and restricted Content runtime guard accept the same
internal shape. Their `SPECTRA_CONTENT_RUNTIME_REVISION` values advance together,
so an already-open page is re-injected before receiving a changed internal intent.

## Registry v2

UI contexts use the Background-owned registry repository:

```text
spectra.registry.get
spectra.registry.add
spectra.registry.remove
spectra.registry.query
spectra.registry.mark-probed
```

Persisted identity is normalized `site:*`; legacy `media:v1:*` fingerprints are compatibility inputs collapsed into the site record during a repository transaction. `route` is `direct | capture`. A returned registry snapshot may update UI projection but never activates Capture.

Resolution, migration, and activation semantics are owned by [control/02-strategy-and-routes.md §4](../control/02-strategy-and-routes.md#4-site-route-registry-and-eligibility-cache).

## Processor lifecycle

Only Boost, EQ, Bass, Compressor, Mono, Pan, and Delay can request a processor, and only with explicit full-output intent. The processor contract contains `boostGain: 1–8` and DSP parameters; page volume, media mute, speed, and transport never cross that boundary.

A transition binds current document identity, generation, and control revision:

1. acknowledge the stable old route at unity;
2. build the candidate behind a closed gate;
3. verify normalized actual configuration, graph signature, source coverage, and running context;
4. switch gates and commit active;
5. release the old route, or restore it when the candidate fails.

Media WebAudio and `tabCapture` have no shared sample clock. The protocol promises a bounded unity handoff without double processing, not sample-synchronous crossfade.

## Runtime and offscreen leases

The passive bootstrap performs bounded one-shot getters plus two capture-phase native media listeners. Those listeners are enabled only after the HELLO initialization barrier, hold one in-flight request plus one latest pending patch, and stop producing observations as soon as a heavy-runtime disposer exists. Heavy Content ownership is tokenized by document and consumer. The final control, restore, hotkey, Popup, remote, or source token releases owned work; a status read or bootstrap native observation creates no token.

One `offscreen.html` hosts Capture processors and remote sessions. Background serializes creation, reconstructs actual host state through HELLO after worker restart, and owns `audio:<tabId>` / `remote:<sessionId>` leases. Content READY consumers wait for the shared Capture reconciliation barrier before hydrating or reusing the runtime. Offscreen execute, sync, and connection-status events retain their Chrome response channel until Background restoration and handling settle, so the first post-restart event cannot outlive its worker. A one-shot Chrome alarm closes the host after the final-lease grace period. Feature modules never call `createDocument()` or `closeDocument()` directly.

## READY and cold-document shortcuts

The wire request is `spectra.content.runtime.ensure` with document identity, reason, and optional capability. Content acknowledges with its `runtimeRevision`. READY means the complete initialization barrier passed, not merely that a script answered.

The closed `spectra.content.default-hotkey.trigger` request carries one of five
shared-resolver actions (`speed_down`, `speed_up`, `volume_down`, `volume_up`,
`volume_mute`) plus `press | release`, a bounded gesture identity, and the repeat
fact. The `document_start` Bootstrap is the sole producer for
`Alt+Left/Right`, `Alt+Down/Up`, and `Alt+M`; the heavy site listener excludes
the same resolver result. The producer emits only after the shared website-first
arbiter's `window` capture recognizer admits its same-event bubble tail; claimed
or propagation-truncated events produce no request, and admission never stops
propagation. Listener ordering, timer-versus-microtask cleanup, and the
closed-shadow/dynamic-listener platform limits are defined only in
[§5](../control/02-strategy-and-routes.md#5-runtime-shortcut-and-feedback-ownership).
Repeated mute presses are suppressed. The five defaults have no
Manifest/default Chrome command slot representation. Background validates the current top-level
`tabId + documentId + gesture` before ensuring runtime or executing the action.

Accepted configured-site gestures are released through the first Bootstrap's
stable trusted-keyup capture observer, not a late heavy-runtime keyup listener.
Bootstrap replacement preserves that raw listener and swaps only a live
isolated-world subscriber. Release signals contain only physical `code`, are
never queued or sent to Background, and never mutate page events. Site repeat
batches have no delayed writer: another physical repeat must consume them, and
keyup or any runtime lifecycle exit discards the remainder.

Identity, invalidation, timeout, cold-document behavior, and feedback ownership are defined in [control/02-strategy-and-routes.md §5](../control/02-strategy-and-routes.md#5-runtime-shortcut-and-feedback-ownership).

## Exact-element page media, native PiP, and fullscreen

- `spectra.media.pip.toggle` and `spectra.video.fullscreen.toggle` return observed native active state.
- `volumeBase`, `mediaMuted`, and `speed` use `page-native -> dom-native`. The page-native request is synchronous, targets one exact media element, and accepts only paired controller getter/setter readback. Before ownership, a rejected or delayed-clamped value may admit the DOM candidate only after the page baseline is stable again; it has no domain list, retained player object, observer, timer, or polling loop.
- Native media events raised while that field's write is pending are correlated ACK/mismatch evidence and cannot submit a competing revision. Later page-originated events are re-read through the selected writer before their `controlled:false` observation commits, so web UI, Popup, remote, restore, and hotkeys project one actual value.

Activation and bridge boundaries are defined in [control/02-strategy-and-routes.md §6](../control/02-strategy-and-routes.md#6-exact-element-page-media-pip-and-fullscreen).

## Privileged boundaries

- page-native MAIN execution is limited to the exact event-target media element and one paired getter/setter with getter readback;
- trusted page hotkeys invoke activation-bound native APIs within the trusted event stack;
- starting Capture additionally requires Background's volatile current-tab extension-invocation admission; Popup and shortcuts reach it only through their validated invocation boundaries, while page activation alone is not admission;
- user scripts require explicit permission and remain in the user-script sandbox;
- URL opening accepts HTTP(S) only;
- remote state and commands remain unavailable until HMAC authentication and stay bound to session, tab, generation, and monotonic sequence.

## Performance boundaries

Default pages have no extension AudioContext, offscreen document, analyser, or periodic work. The two versioned MAIN bridges add no polling: page-media performs work only during an explicit synchronous request, and fullscreen allocates its temporary listener/timer only during an active audio handoff. Continuous UI values are coalesced; persistence is trailing; visualizer consumers use generation-aware leases and bounded sampling from an already-active processor. Hidden or destroyed consumers release their own leases.

## Boundary payloads

Favicon, QR, URL, and origin-sensitive fields are validated before use. QR rendering accepts only a complete validated local image URL. A document without a controllable origin is terminal for that operation and must not be retried as a transient timeout.
