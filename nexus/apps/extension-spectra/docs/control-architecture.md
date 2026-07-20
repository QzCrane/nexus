---
type: reference
status: stable
audience: developer
last_reviewed: 2026-07-20
---

# SPECTRA control architecture

This file is the sole entrypoint for SPECTRA control semantics. Normative content is split by topic under `control/`; this index contains navigation and release-gated totals only.

Do not copy a topic's rules back into this file. Add or change the topic owner, executable contracts, tests, and static gate in the same change.

## Topic index

| # | Owner | Scope |
| --- | --- | --- |
| 01 | [control/01-foundations.md](control/01-foundations.md) | product semantics, control flow, and state ownership |
| 02 | [control/02-strategy-and-routes.md](control/02-strategy-and-routes.md) | strategy order, site routes, runtime READY, feedback, site adapters, PiP, fullscreen |
| 03 | [control/03-ui-and-boundaries.md](control/03-ui-and-boundaries.md) | UI, visualizer, privileged boundaries, loading topology, failure escalation |
| 04 | [control/04-algorithm-matrix.md](control/04-algorithm-matrix.md) | capability and source-algorithm matrix entrypoint |
| 05 | [control/05-control-state.md](control/05-control-state.md) | field state, echo correlation, processor handoff, volume, mute, DSP |
| 06 | [control/06-media-and-video.md](control/06-media-and-video.md) | media identity and selection, playback, video effects, screenshots |
| 07 | [control/07-runtime-and-performance.md](control/07-runtime-and-performance.md) | runtime cost, implementation ownership, migration ledger, cross-world boundary |
| 08 | [control/08-invariants-and-gates.md](control/08-invariants-and-gates.md) | SCTRL invariants and release gate |

## Release-gated totals

- **51 contract capabilities**: 17 native-only + 6 hybrid extension/native + 26 augmentation-only + 2 observation-only
- **28 persistent snapshot fields + 23 momentary operations**
- **50 audited source algorithms**: `ALG-001..ALG-050`
- **44 static invariants**: `SCTRL-001..SCTRL-044`

These totals are mirrors of executable contracts and gates. A count changes only with the corresponding contract rows, source catalog, tests, owner documentation, and verifier update.

## Neighbor owners

- [Runtime topology](architecture.md)
- [Cross-context protocols](protocols.md)
- [Remote security](remote-security.md)
- [WebAudio source admission](cors-data-flow.md)
- [Roadmap](../plan.md)
- [Repository documentation map](../../../docs/documentation-index.md)

## Implementation and verification

- contracts: `packages/contracts/src/control.contracts.ts`
- coordinator: `src/background/control-coordinator.ts`
- native writer: `src/content/logic/native-media-executor.ts`
- static verification: `scripts/verify/check-spectra-control.js`

## Historical evidence

Dated development, regression, and optimization reports live under [`_archive/2026-Q3/`](_archive/2026-Q3/README.md). They preserve the state of their named commit and are not current behavior owners.