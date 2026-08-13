---
type: explanation
status: stable
audience: developer
owner: spectra-runtime-architecture
last_reviewed: 2026-08-13
---

# SPECTRA runtime architecture

SPECTRA is a Chrome MV3 extension with explicit ownership across runtime contexts. Shared protocols/snapshots are in `@nexus/contracts`. Per-field behavior is in [control architecture](../control/README.md).

## Runtime ownership

| Context | Owns | Does not own |
| --- | --- | --- |
| Popup / Options | intent, local render, interaction | actual audio mode, direct storage, executor choice |
| Content, isolated | document identity, media registry, DOM/CSS writers, admitted WebAudio, exact configured-site lean host when injected | Capture-active claims before host ACK, cross-tab hotkey target selection |
| MAIN bridges | fullscreen audio handoff, exact-element page-media getter/setter readback | generic dispatch, domain tables, cross-tab state |
| Background worker | routing, settings, snapshots, badge projection, runtime leases, per-document lean/full hotkey ownership and restart recovery | WebAudio nodes, optimistic UI |
| Unified offscreen host | actual Capture processors, authenticated remote sessions | direct document creation/closure |

`ControlSnapshot` owns actual media/video/DSP fields. `AudioSessionSnapshot` (keyed by document) owns processor mode/phase/config/error. Projections preserve this separation.

## Audio lifecycle

```text
mode: bypass | webaudio | capture
phase: idle | starting | active | stopping | error
```

Navigation/transition advances generation; late ACKs cannot update newer documents. Default is transparent bypass.
Capture activates only after offscreen host creates processor and returns readback. Transitions neutralize old route, verify candidate, switch ownership, and release old route. Capture processor responses remain tab-owned, while Content lifecycle events require the authoritative `documentId` and are delivered through Chrome's exact-document target; a late event for an old document therefore cannot mutate its replacement.

## Unified offscreen host

`offscreen.html` hosts Capture processors and remote sessions. `offscreen-coordinator.ts` exclusively owns `chrome.offscreen.createDocument()` / `closeDocument()`.

- Leases: `audio:<tabId>`, `remote:<sessionId>`
- Serialized creation/reconciliation/close decisions. Closes only after all leases released + 1-shot grace alarm.
- Remote controller is a deferred module. Status requests without runtime return empty exact result.
- HELLO reconstructs processors/sessions after worker restart. Unresponsive hosts enter 30s grace.
- Content READY waits for Capture reconciliation to prevent duplicate Captures.

## MAIN bridges and page-native media semantics

No generic MAIN runtime or domain tables. Two version-guarded bridges own cross-world surface:
1. **Fullscreen V1**: Temporarily yields active audio pipeline around `requestFullscreen()`.
2. **Page-media V2**: Synchronously reads/writes `volumeBase`, `mediaMuted`, `speed` for exact target.

Page-media discovery walks composed-ancestors. Matches require paired getter/setter. Mismatch restores baseline. Admits one `dom-native` fallback before ownership. Bridge retains no controller, domain table, or polling loop.

Media WebAudio is isolated-world. Media element receives at most one `MediaElementSourceNode`. Leaving active processing binds to unity route, never closes binding. Page volume/mute never enter processor contract.

## Settings and route registry

Background owns revisioned settings in `chrome.storage.local`. Revisions are written to physical storage before broadcast.
Per-tab control session is stored in `chrome.storage.session` (`tabId+documentId+origin+resourceUrl`), containing 20 refresh-restorable fields.

Settings commit and settings projection are separate authorities. A mutation ACK means the exact revision is durable and readable by a replacement worker; it does not claim every open tab has already observed the projection. `settings-projection.ts` owns one revision-coalescing queue for extension, Content, hotkey, shortcut, and restore projections. It preserves global/hotkey lanes while selecting the newest snapshot, retries real delivery failures on `50/200/800 ms`, records the last projected revision only after those lanes settle, and wakes from a Chrome alarm after a deferred failure. A destroyed or non-resident Content receiver is terminal for that document because its successor pulls the durable snapshot during bootstrap. Tab work is bounded to eight concurrent deliveries, and hotkey reconciliation reuses the already-enumerated tab snapshot. Global OSD, visualizer, language, and theme projection is presentation-only and never re-enters audio policy.

The `volume`, `volumeBase`, and `boost` fields form one canonical value object. Partial site/preset merges combine the validated patch with existing state before one canonicalization pass, so changing only base or boost cannot persist a contradictory effective volume.

| Patch source | Updates current-resource | Updates origin-portable |
| --- | --- | --- |
| Page observation | yes | removes those fields |
| Popup / remote / shortcut ACK | yes | yes |

Resource URL canonicalization:
- Same URL, new `documentId`: complete patch
- Same-origin, diff URL: origin-portable patch only
- Cross-origin: both retired

A separate monotonic per-tab record owns Action-badge stickiness, surviving worker replacements.
Media route registry (Background-owned) caches `direct | capture` routes as planning hints.

## Media discovery and identity

Content maintains media through event-driven registry. Registration does one viewport-geometry seed. Deduplicated on same-document navigation. Every element independently receives configuration upon registration/play/selection.
Passive bootstrap may do bounded top-level getter. Background captures `volumechange`/`ratechange`, submits complete actual pairs without media identity.

## Runtime loading and shortcuts

Manifest loads minimal isolated bootstrap + closed MAIN bridges. Heavy Content runtime is acquired via consumer tokens. Final consumer releases listeners. Cold-document built-in hotkeys use READY ensure and release their transient capability after the admitted operation.
Offscreen events keep Chrome message channel open until Background settles, preventing suspension mid-event.

Built-in chords (`Alt+Arrow*/Alt+M`) are reserved, claimed at `document_start` before page handlers. Configured-site bindings yield to website claims. Keyup clears unconsumed repeat pulses but cannot revoke an admitted press. `chrome.commands` admits only non-coalescing actions.

### Configured-site lean hotkeys

A configured site may avoid a document-lifetime heavy Content Runtime hotkey lease only when **every live binding** is exactly page-default-equivalent: `speed_up`, `speed_down`, `volume_up`, `volume_down`, or `volume_mute`, with no custom parameters. Disabled, explicit no-op, or otherwise unavailable bindings do not own runtime work. One live non-equivalent binding makes the entire site `full`. The most-specific configured domain is authoritative: an explicitly disabled child suppresses an enabled parent rather than falling through.

Ownership is split into three layers:

1. `site-hotkey-loader-adapter.ts` resolves URL + settings into `none | lean | full` and owns exact heavy-listener suspend/resume projection.
2. `site-hotkey-owner.ts` is the sole Background owner for one `tabId+documentId`. It serializes reconciliations and owns Worker epoch/configuration generation, injection single-flight, lifecycle fencing, and full capability bookkeeping.
3. `content-site-hotkeys.js` is the minimal isolated-world physical input host. It has no settings authority and accepts only exact document configuration.

The exact lean configuration message is:

```text
spectra.content.site-hotkeys.configure
{ epoch, generation, bindings }
```

Rules:

- Every ownership transition starts with an exact **empty lean barrier**. A confirmed missing receiver means the document is already lean-empty. Any other transport/protocol failure is fail-closed.
- For `lean` or `none`, Background then sends an exact-document heavy `spectra.hotkeys.changed` projection with `sites:{}` before releasing any remembered hotkey lease or enabling lean. The heavy runtime may remain resident for restore/observation/control without retaining configured-site keyboard ownership.
- A broad real `spectra.hotkeys.changed` settings publication happens **before** ownership reconciliation. It updates heavy settings, but it is never lean-host configuration authority; the later exact suspend/resume projection determines heavy configured-site ownership for that document.
- A surviving lean host from a previous MV3 worker ACKs the new worker's empty barrier. A new Worker epoch supersedes the old epoch even when its numeric generation restarts lower.
- After injection, a nonempty lean projection must receive the exact `{epoch,generation}` ACK. Missing receiver after successful injection is an error, not a safe no-op.
- The lean host exposes a revision-2 read-only `active` marker in the same isolated-world realm. `getActiveHotkeySettings()` projects `sites:{}` while that marker is active. This physical fence prevents a transient heavy runtime loaded for control/feedback from claiming configured-site repeats during the READY-to-exact-suspend window.
- Per-document transitions serialize across HELLO, settings, History/navigation and lifecycle races. `forget()` increments the lifecycle token without deleting in-flight work; every async continuation proves the same lifecycle before publishing another side effect. A stale full ensure releases the capability it acquired.
- Lifecycle tombstones remain only while an injected host, full capability, injection promise, or transition is observable; retired idle keys are removed.

### Sender-document execution, repeat, and feedback

Lean bindings reuse the existing `spectra.content.default-hotkey.trigger` request with one additional validated disposition:

```text
{ action, phase, gesture, repeated, disposition: 'site-page' }
```

Absent `disposition` retains shipped default/global-hotkey-target semantics. `site-page` bypasses `hotkeyTargetRepository`; Background validates the sender and constructs `origin:'site-page'` with `foreground` and `target` equal to that exact top-level `tabId+documentId`.

The lean host owns only physical gesture admission and identity. Background owns bounded repeat coalescing (`runPageGestureBurst`); completion never self-drains queued pulses, and release discards unconsumed repeats. `volume_mute` is non-repeatable but still preserves the physical repeated fact through release.

Feedback reuses the existing scalar gesture channel and transient shortcut runtime. The same gesture is replayed to the heavy feedback owner if it loads after the first press, so speed/volume/mute retain actual OSD behavior. RPC failures use the existing Content toast. The transient runtime is released after the action/feedback path settles; this is not a document-lifetime hotkey lease.

The lean host survives BFCache `pagehide` when `event.persisted === true`: it releases held gestures but keeps its exact host/listeners in the retained realm. A real page retirement disposes it. Extension-context invalidation also disposes the host so stale code cannot keep calling `preventDefault()` after messaging becomes unavailable.

### MV3 worker-restart heavy-runtime recovery

A service-worker restart loses Background's in-memory runtime leases while an old heavy Content Runtime may survive in a page. `runtime-restart-startup.ts` is wired from the Background entry and recovers each current HTTP top document in this order:

1. exact runtime-status probe;
2. if a current-revision heavy runtime survived, acquire a fixed temporary `worker-restart-recovery` lease through the normal runtime loader;
3. reconstruct source ownership from `ownedSources`;
4. reconstruct the canonical restore capability from the exact tab-session identity/resource hostname;
5. reconcile current configured-site hotkey ownership (`none | lean | full`);
6. release only the temporary recovery lease.

Actual orphan disposal remains inside the normal runtime-loader lease authority, which rechecks concurrent/transient leases before sending RELEASE. Restore/hotkey reconstruction failure deliberately retains the temporary safety lease. Both per-document failures and discovery failures (settings/tab enumeration) use the same bounded retry schedule: `250 ms`, `1 s`, `4 s`. If no heavy runtime survived, recovery does not create one merely because a persistent restore plan exists.

This model removes document-lifetime heavy **hotkey ownership** for eligible sites. It does not promise that an admitted control operation or another independent consumer can never load the heavy runtime transiently.

## Remote control

Optional, capability-bound, authenticated. Requires HMAC-SHA-256 nonce challenge. Allowlisted commands bound to session/tab/generation/sequence.

Remote generation advances in Background only after the authoritative offscreen host accepts the exact state. The host caches accepted state while unauthenticated or disconnected and sends it in the authenticated handshake; a hard send rejection leaves the last accepted generation unchanged, so the next command for that generation is not silently consumed. Out-of-order acknowledgements may advance but never regress accepted generation.

Runtime RPC `source` is a claim, never authority by itself. Popup and page sources must match their physical sender; page mutations require the exact current top document; `remote` and `system` are internal-only and are rejected from runtime messages. The retired Content legacy mutation adapter no longer relabels itself as Popup.

## Protocol compatibility

v2 envelopes validated at runtime. Compatibility adapters are temporary translation boundaries, not alternate protocols. Listeners own exact request-type sets.

## Boundary projections

Favicon/QR are UI/security boundaries, not media capabilities. Exact-element, PiP, fullscreen bridge semantics handled separately.

## Production performance budgets

`scripts/check-production-artifacts.ts` owns hard byte ceilings for service-worker wake (256KiB), manifest `document_start` (24KiB), Content bootstrap (14KiB), lean hotkeys (11KiB), Capture-only offscreen (28KiB), Remote-eventual offscreen (72KiB), Popup static/eventual (144/152KiB), Content runtime eventual (176KiB), video effects (12KiB), Options eventual (40KiB), total JavaScript (680KiB), and total production artifact (780KiB). The v1.4.2 Windows candidate measures 248.8KiB, 18.3KiB, 12.0KiB, 9.1KiB, 24.1KiB, 68.2KiB, 141.7/147.2KiB, 167.0KiB, 10.9KiB, 37.2KiB, 658.2KiB, and 753.3KiB respectively. An intentional increase must update this owner and the executable budget together; source lines and local build time do not substitute for closure measurement.

All tab-set operations use bounded concurrency. Settings and visualizer projection use eight workers, remote restoration uses four, and Capture/runtime-restart flows use their declared bounded fan-out owners. On failure, the fan-out owner stops admitting new items but waits for every live worker to retire before rejecting, so an immediate retry cannot overlap the previous generation and exceed the bound. A new tab-wide `Promise.all` is a release regression unless the owner proves a smaller physical bound.

Release and cross-platform lanes build the production SPECTRA candidate exactly once before Chrome integration. `test:chrome:dist` consumes that existing `dist`; the developer convenience command `test:chrome` alone may prepend a development build. Production artifact integrity remains owned by the production build and is not repeated immediately afterward.

## Current implementation ownership

| Concern | Owner | Invariant |
| --- | --- | --- |
| Route persistence | `registry-repository.ts` | One normalized site route; UI never writes storage |
| Route resolution | Content policy executor | Cache is not activation |
| Processor lifecycle | offscreen coordinator/delegate | Actual host ACK drives status |
| Cold native refresh | bootstrap/coordinator | Targetless 4-field obs; no badge-use fact |
| Built-in shortcut readiness | shared keyboard arbiter + transient READY lease | Exclusive ownership of 5 defaults; no document-lifetime default-hotkey lease |
| Configured-site lean ownership | `site-hotkey-owner.ts` + exact lean host + heavy projection adapter | Empty lean barrier; heavy exact suspend; revision-2 physical fence; sender-document execution |
| Worker-restart heavy recovery | `runtime-restart-startup.ts` + runtime-loader leases | Rebuild durable owners before orphan disposal; bounded retry; no direct RELEASE guess |
| Toast/OSD | Content feedback modules | One feedback owner on Popover; lean reuses existing gesture/feedback path |
| Page media semantics | page-media bridge/native executor | Exact-element readback, DOM fallback, no polling |
| PiP/fullscreen | fullscreen bridge/native executor | Actual native lifecycle preservation |
| Visualizer | subscriber registry/Popup scheduler | Existing active processor only, bounded lease |
| Favicon/QR | Popup/remote renderers | Validated payload, no undeclared capability |
