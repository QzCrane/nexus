---
type: explanation
status: stable
audience: developer
owner: spectra-runtime-architecture
last_reviewed: 2026-07-26
---

# SPECTRA runtime architecture

SPECTRA is a Chrome Manifest V3 extension with explicit ownership across runtime contexts. Shared protocol and authoritative snapshots are defined in `@nexus/contracts`; extension contexts do not invent private wire shapes. Per-field control behavior belongs to [the control architecture](../control/README.md).

## Runtime ownership

| Context | Owns | Does not own |
| --- | --- | --- |
| Popup / Options | user intent, immediate local rendering, accessible interaction | actual audio mode, badge state, direct storage writes, or executor choice |
| Content, isolated world | document identity, media registry, DOM/CSS writers, admitted Media WebAudio graph | Capture-active claims before host ACK |
| MAIN versioned bridges | fullscreen audio handoff and synchronous exact-element page-media getter/setter readback | generic dispatch, domain tables, periodic player synchronization, settings, or cross-tab state |
| Background service worker | routing, settings repository, snapshots, badge projection, runtime/offscreen leases | WebAudio nodes or optimistic UI state |
| Unified offscreen host | actual Capture processors and authenticated remote sessions | direct document creation/closure or inferred leases |

`ControlSnapshot` owns actual media, video, DSP fields, and independent active-media/active-video identities. `AudioSessionSnapshot`, keyed by document identity, owns processor desired/actual mode, phase, generation, normalized actual configuration, and structured error. Popup, badge, and authenticated remote projections preserve that separation.

## Audio lifecycle

Each document runs a generation-aware lifecycle:

```text
mode: bypass | webaudio | capture
phase: idle | starting | active | stopping | error
```

Navigation or a mode transition advances generation; late ACKs cannot update a newer document. The default is transparent bypass: no extension-created AudioContext, DSP, or page-field ownership. Restored non-neutral settings or explicit intent may acquire processing.

Capture becomes active only after the unified offscreen host creates a current-generation processor and returns actual readback. Cross-backend transitions neutralize the stable old route, verify the candidate, switch ownership, and then release the old route. The architecture promises no double DSP and no premature ACK; it does not claim a sample-synchronous crossfade between independent browser audio paths.

## Unified offscreen host

`offscreen.html` hosts per-tab Capture processors and authenticated remote sessions. `background/offscreen-coordinator.ts` is the sole owner of `chrome.offscreen.createDocument()` and `closeDocument()`.

- audio lease: `audio:<tabId>`
- remote lease: `remote:<sessionId>`
- creation, reconciliation, and close decisions are serialized;
- the host closes only after all leases are released and the one-shot grace alarm expires;
- Capture audio messages and HELLO do not load Remote code. The Remote
  controller is one deferred module, and its local opaque PeerJS vendor is one
  retryable single-flight script load admitted only by
  `REMOTE_HOST_CREATE_SESSION`; status/describe/close/state requests with no
  Remote runtime return their empty exact result without waking that boundary;
- HELLO reconstructs processors, remote sessions, and leases after service-worker restart;
- a live host that exhausts HELLO retries remains quarantined while any known
  lease exists; without a known lease it enters the 30-second idle grace, and
  close performs one final HELLO that either recovers authoritative leases or
  reclaims the still-unresponsive stale document;
- Content READY acquisition waits for that Capture reconciliation barrier, so
  restore, hotkeys, Popup, and authenticated remote commands cannot mistake a
  surviving processor for bypass and request a second Capture.

## MAIN bridges and page-native media semantics

There is no generic MAIN runtime and no domain-specific adapter table. Two
manifest-registered, version-guarded bridges own the complete cross-world
surface: fullscreen V1 temporarily yields an active audio pipeline around the
page's real `requestFullscreen()` call, while page-media V2 synchronously reads
or writes `volumeBase`, `mediaMuted`, or `speed` for the exact event-target media
element.

Page-media discovery runs only for an explicit read or write. It walks a bounded
composed-ancestor chain, prefers an explicit media/root association and then the
nearest host, requires a paired getter/setter for the requested field, and uses
the same getter as the write ACK. A mismatch restores the same writer's
baseline. Before ownership, that stable restoration admits one standard
`dom-native` attempt, so a page UI's narrower value range is not mistaken for
the browser media element's capability. Events raised during either attempt
remain correlated with the one pending transaction; after success, observation
continues through the selected writer. The bridge retains no controller, has no
hostname selector, player observer, timer, polling loop, or background UI
synchronization.

Media WebAudio remains isolated-world ownership. A media element receives at most one page-lifetime `MediaElementSourceNode`. Leaving active processing returns an irreversibly bound source to the minimal unity route; it does not close and recreate the binding. Page volume and media mute never enter the processor contract.

Strategy and bridge rules are owned by [control/02-strategy-and-routes.md](../control/02-strategy-and-routes.md).

## Settings and route registry

Background owns the revisioned settings repository in `chrome.storage.local`.
UI contexts submit typed field patches; an accepted revision is written to
physical Chrome storage before Background broadcasts or returns it. A
service-worker timer or in-memory pending map is never a successful settings
ACK. Canonical fields replace legacy aliases through bounded read-only
migration.

The acknowledged per-tab control session is stored separately in
`chrome.storage.session` with `tabId + documentId + origin + resourceUrl`. Its field-level
patch contains exactly the 20 refresh-restorable configuration fields declared
by `CONTROL_SESSION_FIELDS`; it contains neither default-filled guesses nor
media/source identities. Its v3 record separates the complete current-resource
patch from an origin-portable patch:

| Patch source | Updates current-resource | Updates origin-portable |
| --- | --- | --- |
| Page observation | yes | removes those fields |
| Popup / remote / shortcut ACK | yes | yes |

A later page observation therefore cannot leave an older extension
value waiting to reappear on the next video. Every merge or rebind resolves only
after the complete versioned projection is physically present in
`chrome.storage.session`; bounded write failure is propagated instead of
delegated to a timer that an MV3 worker may never run. The resource URL is
canonicalized by the storage owner:

| Navigation type | documentId | Patch inheritance |
| --- | --- | --- |
| Same URL, new `documentId` | same | complete patch |
| Same-origin, different URL | same | origin-portable patch only |
| Cross-origin | new | both retired |

This keeps a muted recommendation
preview from becoming restore intent for a detail video without discarding the
user's explicit enhancement settings. Same-document History API and fragment
changes keep their document state and update the resource key on the next
durable merge. Runtime initialization restores media, video and processor groups
through the coordinator before consulting settings. When no retained projection
exists, the most-specific site preset wins; only a missing site preset falls
back to the selected default global preset. A default-valued retained projection
still suppresses both because its existence records an acknowledged decision.

A separate monotonic per-tab usage record owns Action-badge stickiness. It and
the last acknowledged control state survive document and worker replacement;
after Chrome clears the tab-scoped visible badge during full navigation,
Background waits for current-document initialization and reprojects it at the
completed-tab lifecycle boundary;
the restored control ACK refreshes the numeric/color projection, while tab
close is the sole retirement boundary. Usage without a complete acknowledged
`volumeBase + boost` pair has no visual projection: no dot, background color or
text placeholder is permitted.

The media route registry is a separate Background-owned repository. Popup and Options render the same v2 snapshot. One normalized site has one `direct | capture` route; a cached route is a planning hint, not processing activation. Exact precedence and migration rules are in [control/02-strategy-and-routes.md §4](../control/02-strategy-and-routes.md#4-site-route-registry-and-eligibility-cache).

## Media discovery and identity

Content maintains media through one event-driven registry plus media, visibility, and SPA-navigation events. Registration performs one viewport-geometry seed because the first `IntersectionObserver` delivery is asynchronous; command-time reads still perform no scan or layout. Same-document navigation arrives through Chrome navigation events and is deduplicated before generation advances. Every element has one registration/disposer and independently receives current desired configuration when it registers, loads metadata, plays, or is explicitly selected, so a pre-rendered modal does not need a new DOM node before inheriting the current settings.

The passive bootstrap may perform a bounded top-level getter before the heavy runtime exists. After Background completes the document initialization decision, it also captures native `volumechange` and `ratechange` events and submits only the complete `volumeBase + mediaMuted` or `speed + preservePitch` actual pair. One request may be in flight and one latest patch may wait; the observation has no media identity, never marks badge usage, and still commits through the coordinator and tab-session owner. Installing the heavy runtime disposer transfers event ownership immediately, so restore writes cannot be reflected back as cold-page gestures. Once the runtime is acquired, reads and target-bound observations resolve through the registry without rescanning the document or changing selection.

## Runtime loading and shortcuts

The manifest loads a minimal isolated bootstrap alongside the two closed,
versioned MAIN bridges. Heavy Content runtime ownership is acquired through
identity-bound consumer tokens. The final consumer releases listeners and owned
resources; a status read acquires none. If a runtime is reconstructed from an
acknowledged Capture session, initialization hydrates the existing
Background/offscreen processor ownership without replaying audio policy. Only a
later explicit control, configuration, navigation, or media lifecycle intent may
transition that processor, so Popup/remote observation cannot stop Capture.

Cold-document hotkeys use the same READY ensure path as other runtime consumers. READY is invalidated by navigation, update, context invalidation, health failure, and disposal. Exact readiness and feedback rules are in [control/02-strategy-and-routes.md §5](../control/02-strategy-and-routes.md#5-runtime-shortcut-and-feedback-ownership).

Offscreen execute, sync, and connection-status events keep their Chrome message
response channel open until Background restoration, authorization, READY, and
state synchronization settle. A restarted MV3 worker therefore cannot be
suspended between receipt and completion of the first authenticated event.

The bootstrap also owns the only built-in default-key boundary: trusted
`Alt+ArrowLeft/Right` becomes sender-bound `speed_down/up`,
`Alt+ArrowDown/Up` becomes `volume_down/up`, and `Alt+M` becomes
`volume_mute`. Bootstrap recognizes all five at the page input boundary, where
exact physical press/release identity makes mute ignore repeated keydown and
preserves scalar repeat cadence. `Alt+Up` is additionally the one built-in
Manifest accelerator: when Chrome consumes it, the browser command is the sole
writer and grants current-tab extension invocation for a first-use Capture
fallback; Bootstrap handles only an unassigned or otherwise unconsumed dispatch.
The other four chords have no Manifest/default Chrome command. The shared
resolver excludes all five before the heavy site-hotkey listener performs
binding lookup, so one physical event has only one extension writer.

The five shipped chords are reserved extension commands. Bootstrap claims their
trusted non-editable keydown and matching keyup at `window` capture during
`document_start`, calling `preventDefault()` and `stopImmediatePropagation()`
before page handlers can clamp volume to a native-only range or perform a
competing write. Configured site bindings remain website-first through the
shared same-event bubble-tail arbiter; claimed or propagation-truncated events
still yield to the website. Exact ownership and arbitration semantics are owned
by [control/02-strategy-and-routes.md §5](../control/02-strategy-and-routes.md#5-runtime-shortcut-and-feedback-ownership).
The bootstrap performs no polling and owns no control state.

The first Bootstrap also installs one stable trusted-keyup capture observer for
accepted site gestures. Revision replacement swaps only its isolated-world
subscriber, preserving the raw listener's original document-start ordering. The
observer publishes live `{ code }` cleanup identity, does not queue releases and
does not mutate the website event. Site repeats have no trailing action timer:
only a subsequent physical repeat may consume a bounded pulse batch, while every
release and lifecycle exit drops the remainder.
Background validates the top-level `tabId + documentId + gesture`, acquires the
existing hotkey runtime lease, and submits literal `0.1×`, `10`-point, or mute
toggle coordinator mutations without
accepting admission from the payload. Only after Background rechecks that the
same document is still the active top-level tab does it mint the volatile
invocation-bound Capture admission. The isolated-world gesture channel owns one
monotonic sequence across bootstrap/runtime reinjection and a bounded cold-start
signal queue, so the first key event is replayed once when feedback mounts and
an old release cannot settle a newer gesture.

Built-in scalar gestures and page-defined repeats use exact page
`KeyboardEvent` lifecycles. While actual readback is active, new physical
repeats accumulate up to the fixed bound; only another physical repeat may
consume that batch. Transaction completion never self-drains pending work.
Keyup clears unconsumed repeat pulses but cannot revoke the already admitted
physical press: that one transaction crosses cold runtime ensure and reaches
one coordinator ACK, while release waits for it and cannot start a trailing
writer. `chrome.commands` provides no physical keyup, so its manifest registry
and configurable slots admit only non-coalescing actions through the contract
predicate; those discrete commands retain the single-flight gate.

One `tabId + documentId` initialization promise orders bootstrap restore,
cold native observations, initial snapshot reads and explicit control. The
bootstrap HELLO response opens its observation boundary only after that promise
settles. Restore-origin writes and target-bound heavy-runtime observations bypass
their own barrier, and a failed restore is logged once before later explicit
control is allowed to proceed. This is an ordering boundary, not a second runtime
or settings authority.

## Remote control

Remote control is optional, capability-bound, and authenticated. A fragment secret proves possession through an HMAC-SHA-256 nonce challenge before state or commands are exchanged. Commands are allowlisted and bound to session, tab, generation, and monotonic sequence. See [remote-control security](../security/remote-control.md).

## Protocol compatibility

Current code sends v2 envelopes and validates request payloads and response data at runtime. Narrow named compatibility adapters are temporary translation boundaries, not alternate internal protocols. See [runtime protocols](../reference/protocols.md).

Every message listener owns an exact request-type set. Prefix similarity is not ownership; an unrelated listener returns `false` before validation.

## Boundary projections

Favicon and QR rendering are UI/security boundaries, not media-runtime capabilities. Exact-element page media, PiP, and fullscreen bridge semantics belong to [control/02-strategy-and-routes.md §6](../control/02-strategy-and-routes.md#6-exact-element-page-media-pip-and-fullscreen). Favicon, QR, and origin payload validation belongs to [runtime protocols](../reference/protocols.md#boundary-payloads) and [remote security](../security/remote-control.md).

## Current implementation ownership

| Concern | Owner | Invariant |
| --- | --- | --- |
| Route persistence and migration | `background/registry-repository.ts` | one normalized site route; UI never writes storage |
| Route resolution | Content policy executor | cache is not activation |
| Processor lifecycle | offscreen coordinator and audio delegate | actual host ACK drives status |
| Cold native refresh state | bootstrap, runtime loader and control coordinator | initialization-first, targetless four-field observation; no badge-use fact |
| Shortcut readiness | bootstrap, shared keyboard arbiter, runtime loader and shortcuts | one shared resolver gives the document-start capture Bootstrap exclusive ownership of five reserved defaults; the site listener excludes them and independently yields configured bindings to website claims, while the stable keyup observer releases accepted site gestures without an action timer and trusted cold-document intents wait for READY and reject stale identity |
| Toast/OSD | Content feedback modules | one feedback owner on a fullscreen-safe Popover top-layer host; no bootstrap/snapshot toast |
| Page media semantics | page-media bridge and native executor | exact-element getter/setter readback, DOM fallback, no domain table or polling |
| PiP/fullscreen | trusted activation path, fullscreen bridge and native executor | actual native lifecycle and audio-baseline preservation |
| Visualizer | subscriber registry and Popup scheduler | existing active processor only, bounded lease |
| Favicon/QR | Popup and remote renderers | validated payload, no undeclared capability |
