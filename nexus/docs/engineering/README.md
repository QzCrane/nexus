---
type: explanation
status: stable
audience: contributor
owner: engineering-principles
last_reviewed: 2026-07-20
---

# NEXUS engineering principles

Index of engineering principles **EPR-001..029**. Canonical definitions live in [`../principles/`](../principles/).

## Principle Groups & Compact Index

| Group | Owner | Scope |
| --- | --- | --- |
| EPR-001..009 | [`../principles/01-state-and-ownership.md`](../principles/01-state-and-ownership.md) | SSOT, desired/actual/ACK separation, identity, READY, unique writer, native-first, Capture, site routes |
| EPR-010..018 | [`../principles/02-operations-and-safety.md`](../principles/02-operations-and-safety.md) | Irreversible operations, pure reads, transactions, selection, attribution, native lifecycle, hotkeys, UI contracts, visualizer leases |
| EPR-019..025 | [`../principles/03-runtime-and-quality.md`](../principles/03-runtime-and-quality.md) | SW restart/update recovery, structured errors, external boundaries, authenticated remote, privacy, performance, module direction |
| EPR-026..029 | [`../principles/04-process-and-quality.md`](../principles/04-process-and-quality.md) | Browser-semantic tests, reversible delivery, truthful public copy, Git/AI quality gates |
| Regression | [`../principles/05-problem-to-principle-map.md`](../principles/05-problem-to-principle-map.md) | Historical failures mapped to durable acceptance criteria |

- **EPR-001**: SSOT for every domain; aliases are read-only.
- **EPR-002**: Desired, actual, ACK, snapshot, & optimistic UI separation.
- **EPR-003**: ACKs bind identity (document, media/source, generation, revision).
- **EPR-004**: READY is a capability barrier.
- **EPR-005**: 1 document = 1 writable runtime.
- **EPR-006**: 1 `{document, media, field}` = 1 writer.
- **EPR-007**: Least-invasive native-first strategy.
- **EPR-008**: Capture is explicit full-output DSP path.
- **EPR-009**: 1 site = 1 route.
- **EPR-010**: Prove admission before irreversible operations.
- **EPR-011**: Reads are pure; observation commit is explicit.
- **EPR-012**: Serialized transactions; isolated field failures.
- **EPR-013**: Separate selection, restore, and observation.
- **EPR-014**: Attribute events before selection.
- **EPR-015**: PiP & Fullscreen use native APIs & activation.
- **EPR-016**: Hotkeys have explicit ensure, repeat, and feedback lifecycles.
- **EPR-017**: UI text, icons, reset, & errors are contract-governed.
- **EPR-018**: Visualizers consume existing active processors.
- **EPR-019**: Navigation, update, SW restart invalidate stale identity.
- **EPR-020**: Structured errors (`code + message + retryable + phase`).
- **EPR-021**: Boundary validation for messages, URLs, origins, & QR.
- **EPR-022**: Remote control off by default, HMAC authenticated.
- **EPR-023**: Privacy copy matches physical network traffic.
- **EPR-024**: Performance optimization preserves correctness.
- **EPR-025**: High cohesion & directional module dependencies.
- **EPR-026**: Tests cover ordering, lifecycle, & browser semantics.
- **EPR-027**: Reversible delivery closure.
- **EPR-028**: Public claims never exceed verified capability.
- **EPR-029**: Lefthook Git and AI hooks enforce quality floor.
