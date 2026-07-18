# Media WebAudio source-eligibility flow

This document records the current source-admission algorithm. It does not own a
second mode matrix; [control-architecture.md](./control-architecture.md) remains
authoritative.

This file is the sole owner of source eligibility evidence and irreversible
Media WebAudio admission. Runtime ownership and wire semantics are delegated to
[architecture.md](./architecture.md) and [protocols.md](./protocols.md);
neither is duplicated here.

`createMediaElementSource()` is irreversible for an element and analyser
silence cannot distinguish silence from CORS or protected media. SPECTRA
therefore never binds or samples a source as a probe.

## Admission

1. `MediaRegistry` records every top-level media element and source revision.
2. Before binding, it captures immutable eligibility evidence for that exact
   element/source: same-origin URL or a CORS mode already established before
   resource selection.
3. `assessMediaSourceCoverage()` requires every current registry source to be
   proven eligible. Unknown, inaccessible, protected or unsafe sources fail the
   Media WebAudio candidate without side effects.
4. `WebAudioController.ensureAttached()` consumes the same evidence snapshot,
   creates at most one page-lifetime `MediaElementSourceNode` per element and
   confirms that every source is connected to the shared graph.
5. Only a running graph with full source count, matching graph signature and
   normalized actual config can ACK Media WebAudio.
6. A registered/removed/reloaded source triggers event-driven reconciliation;
   stale document/source/generation results are discarded.

If complete safe coverage is unavailable, explicit full-output DSP may request
authorized Capture. Active-target requests fail rather than silently widening
to the tab. Default/native-only control creates neither Media WebAudio nor
Capture.

## Ownership and cost

- `content/core/media-registry.ts`: source identity, preload evidence and
  event-driven lifecycle.
- `packages/features/audio-engine/src/webaudio/controller.ts`: prospective
  assessment, unique binding, reconnect and complete actual readback.
- `content/logic/policy-executor/index.ts`: coverage decision.
- `content/logic/mode-executor.ts`: acknowledged backend handoff and rollback.

There is no CORS probe repository, analyser-silence heuristic, timed observation
window, standing MAIN bridge or discovery polling.
