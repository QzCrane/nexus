---
type: explanation
status: stable
audience: developer
owner: spectra-runtime-architecture
last_reviewed: 2026-07-26
---

# SPECTRA runtime architecture

SPECTRA is a Chrome MV3 extension with explicit ownership across runtime contexts. Shared protocols/snapshots are in `@nexus/contracts`. Per-field behavior is in [control architecture](../control/README.md).

## Runtime ownership

| Context | Owns | Does not own |
| --- | --- | --- |
| Popup / Options | intent, local render, interaction | actual audio mode, direct storage, executor choice |
| Content, isolated | document identity, media registry, DOM/CSS writers, admitted WebAudio | Capture-active claims before host ACK |
| MAIN bridges | fullscreen audio handoff, exact-element page-media getter/setter readback | generic dispatch, domain tables, cross-tab state |
| Background worker | routing, settings, snapshots, badge projection, runtime leases | WebAudio nodes, optimistic UI |
| Unified offscreen host | actual Capture processors, authenticated remote sessions | direct document creation/closure |

`ControlSnapshot` owns actual media/video/DSP fields. `AudioSessionSnapshot` (keyed by document) owns processor mode/phase/config/error. Projections preserve this separation.

## Audio lifecycle

```text
mode: bypass | webaudio | capture
phase: idle | starting | active | stopping | error
```

Navigation/transition advances generation; late ACKs cannot update newer documents. Default is transparent bypass.
Capture activates only after offscreen host creates processor and returns readback. Transitions neutralize old route, verify candidate, switch ownership, and release old route.

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

Manifest loads minimal isolated bootstrap + closed MAIN bridges. Heavy Content runtime acquired via consumer tokens. Final consumer releases listeners.
Cold-document hotkeys use READY ensure path (invalidated by nav/disposal).
Offscreen events keep Chrome message channel open until Background settles, preventing suspension mid-event.

Built-in chords (`Alt+Arrow*/Alt+M`) are reserved, claimed at `document_start` before page handlers. Configured site bindings yield to website claims.
Isolated-world gesture channel owns one monotonic sequence, replaying first key event once on cold-start if needed.
Keyups clear unconsumed repeat pulses but cannot revoke admitted press. `chrome.commands` admits only non-coalescing actions.

## Remote control

Optional, capability-bound, authenticated. Requires HMAC-SHA-256 nonce challenge. Allowlisted commands bound to session/tab/generation/sequence.

## Protocol compatibility

v2 envelopes validated at runtime. Compatibility adapters are temporary translation boundaries, not alternate protocols. Listeners own exact request-type sets.

## Boundary projections

Favicon/QR are UI/security boundaries, not media capabilities. Exact-element, PiP, fullscreen bridge semantics handled separately.

## Current implementation ownership

| Concern | Owner | Invariant |
| --- | --- | --- |
| Route persistence | `registry-repository.ts` | One normalized site route; UI never writes storage |
| Route resolution | Content policy executor | Cache is not activation |
| Processor lifecycle | offscreen coordinator/delegate | Actual host ACK drives status |
| Cold native refresh | bootstrap/coordinator | Targetless 4-field obs; no badge-use fact |
| Shortcut readiness | shared keyboard arbiter | Exclusive ownership of 5 defaults; yields site bindings |
| Toast/OSD | Content feedback modules | One feedback owner on Popover; no bootstrap toast |
| Page media semantics | page-media bridge/native executor | Exact-element readback, DOM fallback, no polling |
| PiP/fullscreen | fullscreen bridge/native executor | Actual native lifecycle preservation |
| Visualizer | subscriber registry/Popup scheduler | Existing active processor only, bounded lease |
| Favicon/QR | Popup/remote renderers | Validated payload, no undeclared capability |
