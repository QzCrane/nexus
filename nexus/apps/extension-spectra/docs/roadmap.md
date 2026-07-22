---
type: reference
status: draft
audience: contributor
owner: spectra-product-and-engineering
last_reviewed: 2026-07-20
---

# SPECTRA roadmap

> Product position: browser audio, video, playback, hotkey, and authenticated remote control.

This document owns sequencing and unresolved work. It does not own current control semantics; those start at [control architecture](control/README.md).

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

Implementation status and release evidence are read from source, tests, static gates, production artifacts, and dated reports—not inferred from this summary.

## P0: release truth and regression resistance

- keep the 51 capability policies, 49 audited source algorithms, and 44 SCTRL invariants synchronized with contracts and tests;
- close remaining Chrome integration and production-package evidence gaps;
- keep README, privacy policy, store listings, remote-site disclosure, and permission justifications aligned with the release package;
- reject a release when a public claim is broader than browser activation, permission, origin, frame, source, or protected-content boundaries;
- make documentation and toolchain checks mandatory in pull-request CI.

## P1: user-facing control completion

- complete only capabilities represented in the canonical matrix;
- improve target selection and failure explanation without adding a second state owner;
- add manual media selection only through typed intent and explicit product design.

## P2: local AI research

Candidates:

- local vocal separation;
- local speech-to-text and bilingual captions;
- local denoising or enhancement;
- optional media recognition.

No candidate is approved merely because a model can run in WASM. Each requires measured package size, download/startup latency, memory, CPU/GPU use, browser support, privacy, cancellation, fallback semantics, licensing, and an explicit free/paid decision.

## Intentionally unsupported

- generic page-world interception;
- synthetic user activation;
- universal website or protected-media compatibility claims;
- a user-facing “Native/WebAudio/Capture mode” selector;
- Capture as fallback for reads, native media fields, permission denial, stale identity, or protected content;
- success based only on setter return, desired-value echo, or storage write.

## Historical record

Older fixes and implementation snapshots are preserved in [the 2026-Q3 archive](_archive/2026-Q3/README.md) and Git history. They explain why current invariants exist but are not a second roadmap changelog.

## Completion rule

A roadmap item is complete only when the relevant chain closes:

```text
contract → implementation → focused tests → browser/release evidence → owner documentation → public disclosure
```

## References

- [Documentation map](README.md)
- [Control architecture](control/README.md)
- [Runtime protocols](reference/protocols.md)
- [Runtime topology](architecture/runtime.md)
- [Remote security](security/remote-control.md)
- [Media-source admission](architecture/media-source-admission.md)
- [Engineering principles](../../../docs/engineering/README.md)
- [Repository documentation](../../../docs/README.md)