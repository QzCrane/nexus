---
type: reference
status: draft
audience: contributor
last_reviewed: 2026-07-20
---

# SPECTRA roadmap

> Product position: browser audio, video, playback, hotkey, and authenticated remote control.

This document owns sequencing and unresolved work. It does not own current control semantics; those start at [control architecture](docs/control-architecture.md).

## Current baseline

The current architecture defines:

- one acknowledged `ControlSnapshot` for field-level actual state;
- independent processor lifecycle in `AudioSessionSnapshot`;
- one writer per `{document, media, field}`;
- effective volume from 0–800%;
- a 10-band equalizer plus explicit bass, compressor, mono, pan, and delay controls;
- native-first playback and video operations with bounded unsupported results;
- event-driven media identity, runtime leases, and update/navigation recovery;
- authenticated optional remote control with disclosed third-party network dependencies.

Implementation status and release evidence must be read from source, tests, static gates, and dated archive reports—not inferred from this summary.

## Active priorities

### P0: release truth and regression resistance

- keep the 51 capability policies, 50 audited source algorithms, and 44 SCTRL invariants synchronized with contracts and tests;
- close any remaining Chrome integration and production-package evidence gaps;
- keep README, privacy policy, store listings, remote-site disclosure, and permission justifications aligned with the actual release package;
- reject a release when a public claim is broader than browser activation, permission, origin, source, or protected-content boundaries.

### P1: user-facing control completion

- complete only capabilities already represented in the canonical matrix;
- improve target selection and failure explanation without adding a second state owner;
- add manual media selection only through a typed selection intent and explicit product design;
- extend site-native support only with an allowlisted official API, deterministic identity binding, actual readback, and tests.

### P2: local AI research

Candidate work:

- local vocal separation;
- local speech-to-text and bilingual captions;
- local denoising or enhancement;
- optional media recognition.

No candidate is approved merely because a model can run in WASM. Each requires measured package size, memory, CPU/GPU use, startup latency, browser support, privacy behavior, fallback semantics, licensing, and an explicit free/paid decision.

## Work that remains intentionally unsupported

- generic page-world interception;
- synthetic user activation;
- claims of universal website or protected-media compatibility;
- a user-facing “Native/WebAudio/Capture mode” selector;
- Capture as a fallback for ordinary reads, native media fields, permission denial, stale identity, or protected content;
- success based only on a setter return, requested-value echo, or storage write.

## Historical record

Older point fixes and implementation snapshots are preserved in [the 2026-Q3 archive](docs/_archive/2026-Q3/README.md) and Git history. They are evidence for why current invariants exist, not a second changelog embedded in the roadmap.

The malformed legacy entries for the February Site-Bridge and hot-update changes were removed from this file. Their implementation truth must be established from the corresponding commits and current owner documents.

## Completion rule

A roadmap item is complete only when the relevant chain is closed:

```text
contract → implementation → focused tests → browser/release evidence → owner documentation → public disclosure
```

## References

- [Control architecture](docs/control-architecture.md)
- [Runtime protocols](docs/protocols.md)
- [Runtime topology](docs/architecture.md)
- [Remote security](docs/remote-security.md)
- [WebAudio source admission](docs/cors-data-flow.md)
- [Engineering principles](../../docs/engineering-principles.md)
- [Documentation map](../../docs/documentation-index.md)