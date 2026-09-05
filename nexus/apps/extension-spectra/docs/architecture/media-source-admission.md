---
type: reference
status: stable
audience: developer
owner: spectra-media-source-admission
last_reviewed: 2026-09-01
---

# Audio source admission

This document owns source evidence for SPECTRA's three physical audio states. It does not duplicate the capability matrix in [control architecture](../control/README.md) or wire/lifecycle contracts in [runtime architecture](runtime.md) and [protocols](../reference/protocols.md).

## Lowest-cost complete owner

The canonical order is `bypass -> webaudio -> capture`:

1. `bypass`: native page/DOM writers own neutral audio; no `AudioContext`, analyser, offscreen document, or tab stream exists.
2. `webaudio`: one isolated-world, page-lifetime `MediaElementAudioSourceNode` per element feeds the shared sparse graph. It is allowed only when every current media source is proven safe before the first irreversible binding.
3. `capture`: one-shot extension-invocation admission acquires the complete tab mix when page coverage is incomplete, unsafe, protected, or binding/readback fails.

Processor demand never chooses an owner from a volume threshold alone. `resolveDesiredAudioMode()` combines explicit DSP/visible-Visualizer demand with the current registry's exact coverage evidence. A candidate becomes actual only after running context, `graphSignature`, `normalizedActualConfig`, `sourceCount`, document/generation, and revision readback.

## Explicit site processing routes

`SettingsRepository` is the single durable owner for a normalized site's
optional `direct | capture` override. The wire projection is the independent
additive `spectra.registry.*` v2 family; the strict full-settings v2 snapshot is
unchanged and contains no route state. Absence means `auto`:

- `auto` chooses proven page WebAudio first and admitted Capture only when the
  complete page graph is unsafe or unavailable;
- `direct` requires the page-lifetime WebAudio owner and never falls through to
  Capture. A failed page binding remains bypass/error instead of violating the
  user's route;
- `capture` skips a known-bad page graph, but it is only a routing preference.
  It cannot create Capture authority; a current one-shot `CaptureAdmission` is
  still mandatory.

The Background Settings repository owns normalization, the shared revision, capacity,
legacy `mediaRouteRegistry | restrictedRegistry | userRegistry` migration, and
projection. The current key is `siteProcessingRoutes`; migration verifies that
key before retiring legacy keys. User entries outrank automatic evidence, and
the most-specific parent-domain match wins. Popup is only a projection/editor
of this repository state and owns no route storage. Content's bounded
eligibility cache uses the narrower sender-bound `spectra.audio.route.get/record`
projection; Background derives its hostname and delegates to the same repository.
Content never imports Popup CRUD DTOs or writes Chrome storage directly.
Automatic records remain advisory history; only user-sourced entries are hard
route choices. Current-document evidence therefore corrects stale automatic
history without allowing an old `direct` record to suppress a necessary Capture.

## MediaElement WebAudio evidence

`WebAudioController` may bind a source only when its current resource is one of:

- same-origin relative or absolute URL;
- same-origin `blob:` URL;
- `data:` URL owned by the document;
- cross-origin URL whose already-loaded element has explicit `crossOrigin` mode, metadata, no media error, and an exact current-resource evidence record from `media-registry.ts`.

The controller never mutates `crossOrigin`, guesses from analyser silence, binds a subset of current elements, retries a known failure for the same resource, or patches page prototypes. `MediaElementAudioSourceNode` identity is page-lifetime: source changes reuse the same binding; DOM removal/disposal disconnects it; a replacement Content runtime reconnects the existing source rather than creating a second node.

## Capture admission

Capture is an explicit tab/document-scoped fallback:

1. The manifest declares `tabCapture` and `activeTab`; `getMediaStreamId({targetTabId})` requires the temporary invocation grant for that exact tab.
2. Background mints one `CaptureAdmission` bound to `tabId`, top frame, `documentId`, document/worker epochs, operation, expiry, and `oneShot: true`.
3. Content consumes the grant once. Navigation, close, expiry, wrong identity, malformed data, and replay fail before acquisition.
4. Offscreen creates the tab stream, `AudioContext`, stream source, commit gate, and `AudioGraphRouter` for one generation.
5. Active and idle ACKs must match the canonical identity/revision/graph readback; failure or stale completion never masquerades as a state transition.

Capture is never inferred from a status read, background card, page observation, or persisted Visualizer demand. Target-only DSP cannot widen to full-tab Capture. A visible foreground Popup may request an analyser; it uses proven MediaElement WebAudio first and receives a Capture admission only when page coverage cannot safely provide the full source.

## Owners

- `content/core/media-registry.ts`: current elements, source revisions, and exact preload-CORS evidence.
- `packages/features/audio-engine/src/WebAudioController.ts`: page-lifetime binding registry, sparse graph, readback, analyser lease, and deterministic disconnect.
- `content/logic/mode-executor.ts`: serialized three-owner handoff; candidate ACK precedes old-owner release and failed handoff restores the acknowledged owner.
- `background/settings-repository.ts` + `media-route.contracts.ts`: durable site route, migration, exact guards, and parent-domain selection.
- `background/capture-admission.ts` + `handlers/capture.ts`: one-shot Capture authority, serialized transition, exact ACK validation, session commit, and bounded cleanup.
- `offscreen/audio-host.ts`: physical Capture graph and stream cleanup.
- Popup visualizer + `background/handlers/audio.ts`: visible-source lease, at most 15 Hz sampling, bounded fan-out/backoff, and final release.

Forbidden designs are partial page binding, synthetic spectrum, persistent analyser demand, all-tab acquisition, standing MAIN-world audio ownership, source-prototype interception, and optimistic processor state.
