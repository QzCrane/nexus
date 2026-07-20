---
type: reference
status: stable
audience: developer
owner: spectra-media-source-admission
last_reviewed: 2026-07-20
---

# Media WebAudio source admission

This document owns source-eligibility evidence and irreversible Media WebAudio admission. It does not own a second control matrix; [control architecture](../control/README.md) remains authoritative. Runtime ownership and wire semantics belong to [runtime architecture](runtime.md) and [protocols](../reference/protocols.md).

`createMediaElementSource()` is irreversible for an element, and analyser silence cannot distinguish silence from CORS or protected media. SPECTRA therefore never binds or samples a source as a probe.

## Admission

1. `MediaRegistry` records every top-level media element and source revision.
2. Before binding, it captures immutable eligibility evidence for that exact element/source: same-origin URL or CORS mode established before resource selection.
3. `assessMediaSourceCoverage()` requires every current registry source to be proven eligible. Unknown, inaccessible, protected, or unsafe sources fail the Media WebAudio candidate without side effects.
4. `WebAudioController.ensureAttached()` consumes the same evidence snapshot, creates at most one page-lifetime `MediaElementSourceNode` per element, and confirms every source is connected to the shared graph.
5. Only a running graph with full source count, matching graph signature, and normalized actual configuration can ACK Media WebAudio.
6. Registered, removed, or reloaded sources trigger event-driven reconciliation; stale document/source/generation results are discarded.

If complete safe coverage is unavailable, explicit full-output DSP may request authorized Capture. Active-target requests fail rather than silently widening to the tab. Default and native-only control creates neither Media WebAudio nor Capture.

## Ownership and cost

- `content/core/media-registry.ts`: source identity, preload evidence, and event-driven lifecycle.
- `packages/features/audio-engine/src/webaudio/controller.ts`: prospective assessment, unique binding, reconnect, and complete actual readback.
- `content/logic/policy-executor/index.ts`: coverage decision.
- `content/logic/mode-executor.ts`: acknowledged backend handoff and rollback.

There is no CORS probe repository, analyser-silence heuristic, timed observation window, standing MAIN bridge, or discovery polling.