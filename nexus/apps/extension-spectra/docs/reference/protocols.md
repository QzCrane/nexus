---
type: reference
status: stable
audience: developer
owner: spectra-runtime-protocol
last_reviewed: 2026-11-01
---

# SPECTRA runtime protocols

This document owns cross-context envelopes, request/response validation, the private continuous Popup port, the private diagnostic port, the Action Popup bootstrap parameter, state flow, READY, leases, configured-site hotkey authority, and MV3 restart recovery. Per-capability writer selection belongs to [the control architecture](../control/README.md); remote authentication belongs to [remote security](../security/remote-control.md).

## State ownership

| Context | Owns | Must not do |
| --- | --- | --- |
| Popup / Options | intent, local rendering, accessible interaction | predict actual state, write badge/storage, or select executor |
| Content, isolated | document/media identity, DOM/CSS writers, source-keyed state, admitted WebAudio, exact lean-host physical binding projection | acknowledge stale work, claim Capture before actual ACK, choose a cross-tab hotkey target |
| MAIN bridges | fullscreen audio handoff, exact-element page-media read/write | generic dispatch, domain tables, periodic sync, cross-tab state |
| Background | serialization, settings, `ControlSnapshot`, `AudioSessionSnapshot`, badge, runtime leases, per-document lean/full transition and worker-restart recovery | treat reads as activation, close offscreen outside coordinator |
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

`ControlSubmitRequest` never carries Capture authority. Background adds `captureAdmission: 'extension-invocation'` to internal `ControlIntent` only after confirming a valid current-tab extension invocation. Value is consumed by policy, not saved in snapshot.

Configured-site lean hotkeys do **not** self-assert control routing. They send the existing default-hotkey trigger with `disposition:'site-page'`; Background validates the content sender, binds foreground/target to that exact top-level `tabId+documentId`, then executes through the same shortcut/control coordinator used by other trusted hotkeys.

## Private continuous Popup port

Discrete Popup controls use the v2 envelope. Continuous volume and DSP use one
private port (`spectra-popup-control`) whose Background-owned latest slot invokes
the same `ControlCoordinator`. The port is a transport, not a second mutation
owner, and it never changes the v2 wire.

```text
Popup -> Background
  { type:'open', sessionId, tabId, documentId }
  { type:'stage', sessionId, inputRevision,
    effectiveVolume?, tone?,
    groups:[{ requestedCoverage:'active-target'|'full', patch }] }
  { type:'flush', sessionId, throughRevision }

Background -> Popup
  { type:'ready', sessionId }
  { type:'settled', sessionId, throughRevision, volumeAck, fieldAcks, error }
```

| Constraint | Value |
| --- | --- |
| Groups per stage | at most 2, one per `requestedCoverage` |
| Field ownership | a field may appear in one group only |
| `sessionId` | 1–128 characters |
| `documentId` | 1–256 characters |
| `inputRevision` / `throughRevision` | positive safe integer |
| `ready` timeout | 5 s |

The port is admitted only from a sender with this extension's id, the exact
`popup.html` URL, and no owning tab; any other sender is disconnected before a
message is read. `open` binds one `sessionId` to one `tabId + documentId` for the
life of the port, and every later message must repeat that session id.

A stage must carry at least one of `effectiveVolume`, `tone`, or a nonempty
group. `tone` is the exact `VolumeTone` the card is painting, not a threshold for
the receiver to reinterpret: a volume number cannot be turned into a route. The
Background applies that tone to the Action badge before awaiting any
acknowledgement, so the badge and the slider change colour in the same turn. The
badge's `isCapture` fact still comes only from the acknowledged lifecycle; a
predicted violet is a tone, never a Capture claim.

`ready` must match the opening session; without it within five seconds the Popup
reports the Background as not ready and disconnects. Disconnect retires the
response channel after Background admission, not an intent it already accepted.
Closing rejects every unsettled waiter, and a `flush` after close is rejected
instead of creating a waiter nobody settles.

## Action Popup bootstrap parameter

`popup.html?cards=N` is a Popup-URL parameter written by
`chrome.action.setPopup`, not a runtime envelope: it crosses no context boundary
as a message and carries no authority. `N` is a one-to-three digit non-negative
count of cards the Background expects this open to draw. The render-blocking head
script reads it only to select a recorded height (`spectra.popup.frame.<N>`); it
never renders or hides a card, and an absent or invalid value falls back to the
last settled height and then to the legacy single hint. `shared/popup-bootstrap.ts`
is the sole owner of the parameter name and every storage key it selects.

## Private diagnostic port

Diagnostics use a second private port, `nexus.local-diagnostics.v1`, in the
opposite direction: an Options surface asks, the Background answers once.

```text
Options -> Background   (connect, no payload)
Background -> Options
  { ok: true, bundle }
  { ok: false, code: 'diagnostic-collection-failed' }
```

| Constraint | Value |
| --- | --- |
| Sender | this extension's id, a `chrome-extension:` URL on that id, no credentials or port, exact origin when the browser supplies one |
| Lifetime | one bundle per connection; the port is disconnected after the reply |
| Budget | 5 s on both ends; an expired port is disconnected rather than left open |
| Payload identity | never read; the browser's sender metadata is the whole authority |

The bundle is a `schemaVersion: 1` record whose scalar-only shape, field list
and redaction rules belong to [local diagnostics](../architecture/runtime.md#local-diagnostics).
Nothing here may carry a page, tab, document or request identity, and a failed
collection is reported as `diagnostic-collection-failed` rather than as a
partial bundle.

## Site processing routes

The stable `spectra.settings.get/patch` v2 ABI does not contain site-route
fields. Adding `mediaRoutes` under the same protocol version breaks resident
Popup/Options contexts when an MV3 worker is replaced. Site processing routes
therefore use the independent, additive `spectra.registry.get/add/remove/query/
mark-probed` v2 family. These routes are one wire projection, not a second
persistence owner: `SettingsRepository` alone owns normalization, the shared
settings revision, migration, capacity, and the `siteProcessingRoutes` storage
key.

Each normalized domain has at most one `direct | capture` record; absence means
`auto`. Content records only acknowledged active page-WebAudio or Capture
ownership, while a user entry wins until current runtime evidence disproves an
impossible `direct` route. Popup renders and edits the same projection. Route
state never grants Capture; the one-shot current-document admission remains
mandatory.

An automatic record is durable history and a list projection, not a hard route
pin: current-document `SAFE | RESTRICTED | PENDING` evidence selects the live
candidate. Only a user-sourced `direct | capture` entry overrides that evidence.

Popup owns the full Registry CRUD projection. Content uses only the additive,
sender-bound `spectra.audio.route.get/record` capability: Background derives the
domain from the current document sender, returns `{ mediaRoute, source }`, and
delegates automatic evidence to the same `SettingsRepository`. Content cannot
name, inspect, or mutate another site and does not carry Popup list DTOs.

`spectra.audio.config.get` keeps its original v2 ABI and returns `AudioConfig`.
New Content runtimes use the additive `spectra.audio.policy.get` route to receive
`{ config, mediaRoute }`. Existing route response shapes must not be changed
under the same protocol version: this additive split permits old resident
Content and a newly restarted Background worker to coexist during an extension
update. The extension-internal envelope remains v2; authenticated Remote wire is
a separate v3 protocol with its own epoch/command contracts.

## Processor lifecycle

Only Boost/EQ/Bass/Compressor/Mono/Pan/Delay can request processor (full-output intent). `boostGain: 1–8` is the sole admitted range; no 0-gain substitution or implicit limiting. The exact-target stream-ID call additionally requires the manifest's temporary `activeTab` authority, granted only by the user's action or registered Chrome command for that page; `tabCapture` alone does not authorize a named target.
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

Wire request is `spectra.content.runtime.ensure`. Content ACKs with `runtimeRevision`. READY means the full initialization barrier passed.

`spectra.content.runtime.status` adds optional `mediaIntentState` with the closed
values `unset/retained/released`. Current bootstrap always emits it by reading
the surviving executor; older responses may omit it. This is lifecycle evidence,
not a second desired-value store or a physical speed ACK. Same-document worker
recovery preserves retained/released decisions and uses the single restore lease;
the [media owner](../control/06-media-and-video.md#document-replay-intent-lifetime)
defines the transitions. Pure status replies cannot revive retired documents or
templates explicitly released after their read began.

`spectra.content.default-hotkey.trigger` carries:

```text
{
  action: speed_down | speed_up | volume_down | volume_up | volume_mute,
  phase: press | release,
  gesture: string,
  repeated: boolean,
  disposition?: 'site-page'
}
```

Bootstrap is the sole producer for reserved `Alt+*` defaults and leaves `disposition` absent. Absent disposition preserves the Background hotkey-target resolver. The lean configured-site host sends only the exact `site-page` disposition; no other disposition is valid.

For `site-page`, Background validates the current top-level HTTP sender, validates that the document is still current, and constructs `origin:'site-page'` with `foreground === target === sender document`. This path never reads `hotkeyTargetRepository`.

Both dispositions share the Background `runPageGestureBurst` owner. A press admitted while another writer is active contributes a bounded pending pulse; completion never self-drains. Physical release drops unconsumed pulses and waits only for the already-admitted operation. `volume_mute` does not execute repeat presses but preserves the repeated fact through release.

## Exact configured-site lean protocol

### Eligibility

A site is lean only when every **live** binding is one of the five canonical scalar/default actions and has no custom parameters. Disabled, explicit no-op, and otherwise unavailable bindings are inactive for runtime ownership. One live non-equivalent binding makes the whole site full. The most-specific configured domain is authoritative; a disabled child suppresses an enabled parent.

### Lean configuration authority

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

The content host synchronously responds:

```text
{ accepted: true, epoch, generation }
```

The ACK must echo the exact accepted authority. A delivery is classified as:

- **delivered**: exact ACK matched;
- **absent**: Chrome explicitly reports no receiving end;
- **failure**: every other transport/protocol outcome.

`absent` is safe only for the **empty barrier**. After Background successfully injects `content-site-hotkeys.js`, a missing receiver for a nonempty configuration is failure.

### Ownership transition ordering

For every `none | lean | full` transition:

1. send exact empty lean configuration;
2. if next mode is `lean` or `none`, exact-project heavy `spectra.hotkeys.changed` with `sites:{}` so a resident heavy runtime loses configured-site keyboard ownership;
3. release obsolete remembered full hotkey capability, if any;
4. for `lean`, inject/configure the lean host;
5. for `full`, acquire/retain the full runtime capability and exact-project the real hotkey settings to restore heavy configured-site ownership.

A heavy-suspension failure is fail-closed: the old full lease is retained and lean is not enabled. Broad real settings publication happens before reconciliation; it updates heavy settings but does not configure the lean host. The exact per-document projection after that publication decides heavy configured-site ownership.

Same Worker epoch accepts only increasing generation. A different Worker epoch supersedes the old one even when its numeric generation restarts lower.

Per-document reconciliation is serialized. `forget(tabId, documentId)` advances lifecycle generation without deleting in-flight transition/injection state. Async injection/configuration/full-ensure continuations must prove the same lifecycle before publishing. A full capability acquired after retirement is released immediately. Retired lifecycle records disappear when no owned/in-flight state remains.

### Same-realm physical dual-owner fence

`content-site-hotkeys.js` exposes a revision-2 read-only isolated-world marker:

```text
window.__SPECTRA_LEAN_SITE_HOTKEY_HOST__.active
```

The heavy Content settings projection checks that marker. While lean is active, `getActiveHotkeySettings()` exposes no configured sites to the heavy listener. This is a physical same-realm fence for the transient READY window: even if heavy Content loads to execute a lean action or show feedback before Background's exact suspension message arrives, the heavy configured-site listener cannot claim the same key stream.

### Physical gesture and feedback

The lean host owns website-first admission, physical `code`, gesture identity, release, BFCache lifecycle, and extension-context retirement. It never queues/mutates `KeyboardEvent` objects and yields to a same-event website claim before `preventDefault()`.

The host publishes the existing default-scalar gesture channel using `nextScalarGestureId('site')`. If the transient heavy runtime loads after the first press, the pending gesture is replayed so the existing actual-OSD owner can claim it. Background executes the action through the normal transient shortcut runtime and sends the normal hotkey feedback event; ordinary RPC failures are rendered by the existing Content toast.

The host survives BFCache `pagehide` when `event.persisted` is true: held gestures are released, but its exact host/listeners remain in the retained realm. A real page retirement or invalid extension context disposes it.

## MV3 worker-restart runtime recovery

A worker restart loses Background's in-memory lease maps while a previous heavy Content Runtime may survive in a document. Background startup runs recovery for current HTTP top documents:

1. exact status probe;
2. require current `runtimeRevision` before adopting the survivor;
3. acquire a fixed temporary `worker-restart-recovery` lease through the normal runtime loader;
4. reconstruct source leases from `ownedSources`;
5. reconstruct the persistent restore capability from the exact tab-session `resourceUrl` hostname;
6. reconcile current configured-site hotkey mode;
7. release only the temporary recovery lease.

Actual runtime disposal remains owned by the normal loader. Releasing the temporary recovery lease rechecks every concurrent source/restore/control/hotkey lease before RELEASE. A failed restore/hotkey reconstruction leaves the safety lease held rather than guessing that the survivor is orphaned.

If status proves no heavy runtime survived, recovery does not create one solely because a persistent restore plan exists. Both per-document recovery failures and startup discovery failures use the same bounded retries: `250 ms`, `1 s`, `4 s`.

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

Default pages have no extension AudioContext, offscreen document, analyser, or periodic work. Continuous UI values coalesce. A visible foreground Popup visualizer may explicitly declare one `captureTabId`; Background validates the Popup/current-document boundary, mints a one-shot Capture admission, and Content owns an idempotent subscriber token. Frames are generation-aware and bounded to 15 Hz; empty batches, disconnect, expiry, blur/pagehide, navigation, and tab close release transient demand, while background cards cannot acquire processing.

A lean configured site may inject the small exact host, but it must not retain the heavy Content Runtime merely because the site has bindings. An admitted action or another independent consumer may transiently load the heavy runtime; this is distinct from document-lifetime hotkey ownership. Production build enforces the lean host's physical artifact ceiling independently.

## Boundary payloads

Favicon, QR, URL, origin fields validated before use. QR requires complete validated local URL. Terminal origin failures not retried.
