---
type: reference
status: stable
audience: developer
owner: spectra-control-architecture
last_reviewed: 2026-07-22
---

# SPECTRA control architecture

This is the sole entrypoint for SPECTRA control semantics. Normative content is split by topic in this directory; this index contains navigation and release-gated totals only.

Do not copy a topic's rules back into this file. Change the topic owner, executable contracts, tests, and static gate in one closure.

## Topic index

| # | Owner | Scope |
| --- | --- | --- |
| 01 | [01-foundations.md](01-foundations.md) | product semantics, control flow, and state ownership |
| 02 | [02-strategy-and-routes.md](02-strategy-and-routes.md) | strategy order, site routes, runtime READY, feedback, exact-element page media, PiP, fullscreen |
| 03 | [03-ui-and-boundaries.md](03-ui-and-boundaries.md) | UI, visualizer, privileged boundaries, loading topology, failure escalation |
| 04 | [04-algorithm-matrix.md](04-algorithm-matrix.md) | capability and source-algorithm matrix entrypoint |
| 05 | [05-control-state.md](05-control-state.md) | field state, echo correlation, processor handoff, volume, mute, DSP |
| 06 | [06-media-and-video.md](06-media-and-video.md) | media identity and selection, playback, video effects, screenshots |
| 07 | [07-runtime-and-performance.md](07-runtime-and-performance.md) | runtime cost, implementation ownership, migration ledger, cross-world boundary |
| 08 | [08-invariants-and-gates.md](08-invariants-and-gates.md) | SCTRL invariants and release gate |

## Release-gated totals

- **51 contract capabilities**: 17 native-only + 6 hybrid extension/native + 26 augmentation-only + 2 observation-only
- **28 persistent snapshot fields + 23 momentary operations**
- **50 audited source algorithms**: `ALG-001..ALG-050`
- **44 static invariants**: `SCTRL-001..SCTRL-044`

These totals mirror executable contracts and gates. A count changes only with contract rows, source catalog, tests, owner documentation, and verifier updates.

## Neighbor owners

- [Runtime topology](../architecture/runtime.md)
- [Cross-context protocols](../reference/protocols.md)
- [Remote security](../security/remote-control.md)
- [Media WebAudio source admission](../architecture/media-source-admission.md)
- [Roadmap](../roadmap.md)
- [SPECTRA documentation map](../README.md)
- [Repository documentation map](../../../../docs/README.md)

## Implementation and verification

- contracts: `packages/contracts/src/control.contracts.ts`
- coordinator: `src/background/control-coordinator.ts`
- native writer: `src/content/logic/native-media-executor.ts`
- static verification: `scripts/verify/check-spectra-control.js`

## Historical evidence

Dated development, regression, and optimization reports live under [`../_archive/2026-Q3/`](../_archive/2026-Q3/README.md). They preserve the state of their named commit and are not current behavior owners.
