# SPECTRA architecture

SPECTRA is a Chrome MV3 extension with explicit ownership across its runtime contexts. The shared protocol and the authoritative `AudioSessionSnapshot` are defined in `@nexus/contracts`; extension contexts do not invent private wire shapes.

## Runtime ownership

| Context | Owns | Does not own |
| --- | --- | --- |
| Popup / Options | User intent, immediate local rendering and accessible interaction | Actual audio mode, badge state or direct storage writes |
| Content (isolated world) | Current document identity, desired config/mode and the event-driven media registry | Claiming Capture active before an ACK |
| MAIN injector | The page WebAudio graph, playback-rate/fullscreen wrappers and their disposer | Persistent settings or cross-tab state |
| Background service worker | Protocol routing, settings repository, session snapshots, badge projection and offscreen leases | WebAudio nodes or optimistic UI state |
| Unified offscreen host | Actual Capture processors and authenticated PeerJS sessions | Direct document creation/closure |

The stable read model is `AudioSessionSnapshot`, keyed by `tabId + documentId + origin`. It contains the generation, desired/actual mode, phase, configuration revision, actual configuration and last structured error. Popup, badge and remote state are projections of that snapshot.

## Audio lifecycle

Each document runs one generation-aware state machine:

- mode: `bypass | webaudio | capture`
- phase: `idle | starting | active | stopping | error`
- navigation or a mode transition advances `generation`; a late ACK cannot update a newer document

Default configuration is a transparent bypass: no extension-created `AudioContext`, no DSP and no page-volume or playback-rate ownership. A restored non-default site configuration or explicit user intent may activate processing.

Capture becomes active only after the unified offscreen host creates a processor and returns a current-generation ACK. Transitions first make the old path transparent, start and confirm the new path, then release the old path, preventing double gain.

## Unified offscreen host

`offscreen.html` hosts both per-tab Capture processors and authenticated remote sessions. `background/offscreen-coordinator.ts` is the sole owner of `chrome.offscreen.createDocument()` and `closeDocument()`.

- audio lease: `audio:<tabId>`
- remote lease: `remote:<sessionId>`
- concurrent creation is serialized
- the host closes only after every lease has been released for a one-shot, service-worker-safe 30-second alarm
- a host handshake reconstructs processors, remote sessions and leases after a service-worker restart

## MAIN runtime

The injector installs one versioned singleton per page. Its `AudioContext`, wrapper descriptors, observers and listeners share one disposer. A `WeakMap` guarantees at most one `MediaElementSourceNode` per media element for the page lifetime. A hot update reuses the compatible runtime; a source that cannot be safely adopted remains in transparent bypass until the next full navigation and is never rebound.

Fullscreen does not suspend the audio context, force volume to one or clear mute. Leaving WebAudio atomically resets DSP parameters and restores page-owned baselines.

## Settings and media discovery

Background owns the revisioned settings repository in `chrome.storage.local`. UI contexts send field-level patches; `chrome.storage.session` stores only current tab/document mirrors. The one-release legacy theme adapter can only submit a candidate to the repository's atomic consume operation; it cannot inspect migration metadata or write storage. Canonical `lang` and `themeMode` are the only fields updated by new code, while old aliases remain read-only through 1.3.4. Domain matching uses normalized lower-case IDNA hostnames, label boundaries for domains and exact matching for IP addresses.

Content discovers media through one mutation registry plus media, visibility and SPA-navigation events. Chrome's `webNavigation.onHistoryStateUpdated` and `onReferenceFragmentUpdated` deliver same-document changes as validated v2 events because an isolated-world History wrapper cannot observe page-world `pushState`; Content deduplicates those events before advancing generation. Every element gets one registration/disposer and independently receives the current desired configuration. There are no 1/3/5-second discovery loops or visible-tab heartbeats.

## Remote control

Remote control remains PeerJS-based but is capability-bound and authenticated. A 128-bit fragment secret proves possession through an HMAC-SHA-256 nonce challenge before state or commands are exchanged. Commands are allowlisted and bound to the exact session, tab, generation and monotonic sequence. See [remote-security.md](./remote-security.md).

## Protocol and compatibility

New code sends protocol v2 envelopes and validates both request payloads and response data at runtime. Narrow named v1 adapters remain for one release so already-loaded contexts can receive compatibility events; they are not an alternate internal protocol. See [protocols.md](./protocols.md) for the wire contract and transition diagrams.
