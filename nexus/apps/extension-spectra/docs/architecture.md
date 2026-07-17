# SPECTRA architecture

SPECTRA is a Chrome MV3 extension with explicit ownership across its runtime contexts. The shared protocol and authoritative snapshots are defined in `@nexus/contracts`; extension contexts do not invent private wire shapes. Per-field control behavior is owned by [control-architecture.md](./control-architecture.md).

## Runtime ownership

| Context | Owns | Does not own |
| --- | --- | --- |
| Popup / Options | User intent, immediate local rendering and accessible interaction | Actual audio mode, badge state or direct storage writes |
| Content (isolated world) | Current document identity, event-driven media registry, the sole DOM/CSS writers and the admitted Media WebAudio graph | Claiming Capture active before an ACK |
| MAIN site adapter | One allowlisted official page-world API call after a typed DOM failure | Any standing runtime, listener, patch, setting or cross-tab state |
| Background service worker | Protocol routing, settings repository, session snapshots, badge projection and offscreen leases | WebAudio nodes or optimistic UI state |
| Unified offscreen host | Actual Capture processors and authenticated PeerJS sessions | Direct document creation/closure |

`ControlSnapshot` is the sole actual source for media, video and DSP fields and
the independent active-media/active-video identities. `AudioSessionSnapshot`,
keyed by `tabId + documentId + origin`, owns only processor lifecycle: desired
and actual mode, phase, generation, normalized actual configuration and the last
structured error. Popup, badge and authenticated remote views preserve that
separation instead of overlaying one snapshot on the other.

## Audio lifecycle

Each document runs one generation-aware state machine:

- mode: `bypass | webaudio | capture`
- phase: `idle | starting | active | stopping | error`
- navigation or a mode transition advances `generation`; a late ACK cannot update a newer document

Default configuration is a transparent bypass: no extension-created `AudioContext`, no DSP and no page-volume or playback-rate ownership. A restored non-default site configuration or explicit user intent may activate processing.

Capture becomes active only after the unified offscreen host creates a processor and returns a current-generation ACK. Cross-backend transitions acknowledge the old path at unity, build and confirm the new path, then release the old path. This prevents double DSP and premature ACK; because page `AudioContext` and `tabCapture` have no shared sample clock, the contract permits a bounded unity handoff and does not claim sample-synchronous crossfade.

## Unified offscreen host

`offscreen.html` hosts both per-tab Capture processors and authenticated remote sessions. `background/offscreen-coordinator.ts` is the sole owner of `chrome.offscreen.createDocument()` and `closeDocument()`.

- audio lease: `audio:<tabId>`
- remote lease: `remote:<sessionId>`
- concurrent creation is serialized
- the host closes only after every lease has been released for a one-shot, service-worker-safe 30-second alarm
- a host handshake reconstructs processors, remote sessions and leases after a service-worker restart

## MAIN site adapters

There is no generic MAIN runtime. Known site adapters are loaded on demand through one document-scoped manager and use the site's official API as the single writer. The default page retains native constructor and descriptor identity.

Media WebAudio ownership remains in the isolated document runtime. A `WeakMap` guarantees at most one `MediaElementSourceNode` per media element for the page lifetime. Fullscreen does not suspend audio, force volume to one or clear mute. Leaving processing acknowledges a neutral route before releasing owned work and restores page-owned baselines; page volume and media mute never enter the processor contract.

## Settings and media discovery

Background owns the revisioned settings repository in `chrome.storage.local`. UI contexts send field-level patches; `chrome.storage.session` stores only current tab/document mirrors. The one-release legacy theme adapter can only submit a candidate to the repository's atomic consume operation; it cannot inspect migration metadata or write storage. Canonical `lang` and `themeMode` are the only fields updated by new code, while old aliases remain read-only through 1.3.4. Domain matching uses normalized lower-case IDNA hostnames, label boundaries for domains and exact matching for IP addresses.

Content discovers media through one mutation registry plus media, visibility and SPA-navigation events. Chrome's `webNavigation.onHistoryStateUpdated` and `onReferenceFragmentUpdated` deliver same-document changes as validated v2 events because an isolated-world History wrapper cannot observe page-world `pushState`; Content deduplicates those events before advancing generation. Every element gets one registration/disposer and independently receives the current desired configuration. There are no 1/3/5-second discovery loops or visible-tab heartbeats.

## Remote control

Remote control remains PeerJS-based but is capability-bound and authenticated. A 128-bit fragment secret proves possession through an HMAC-SHA-256 nonce challenge before state or commands are exchanged. Commands are allowlisted and bound to the exact session, tab, generation and monotonic sequence. See [remote-security.md](./remote-security.md).

## Protocol and compatibility

New code sends protocol v2 envelopes and validates both request payloads and response data at runtime. Narrow named v1 adapters remain for one release so already-loaded contexts can receive compatibility events; they are not an alternate internal protocol. See [protocols.md](./protocols.md) for the wire contract and transition diagrams.

Every `chrome.runtime.onMessage` listener owns an exact request-type set. Prefix
matching is not routing: a listener must return `false` before validation when
the type belongs to another owner, so `spectra.tab.visible.list` cannot be
claimed by the pin/mute command listener. The canonical request map and narrow
UI/Content facades validate the same payload and response shape.

Already-loaded Content contexts treat extension reload/update invalidation as a
terminal lifecycle event. The side-effect-free context guard catches both a
missing runtime id and the synchronous `sendMessage()` invalidation throw,
disposes the old bootstrap once and suppresses only that known teardown error.
Unrelated malformed-command and transport failures continue to surface.
