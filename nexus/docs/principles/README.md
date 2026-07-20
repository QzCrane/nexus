---
type: explanation
status: stable
audience: contributor
last_reviewed: 2026-07-20
---

# NEXUS engineering principles (full definitions)

This directory owns the complete EPR-001..029 definitions referenced by the compact index in [`../engineering-principles.md`](../engineering-principles.md). The compact index is the entry point; [`../engineering/README.md`](../engineering/README.md) owns the EPR authority record, and the documents below are the authority for each principle group.

## Principle groups

| Group | Owner | Scope |
| --- | --- | --- |
| EPR-001..009 | [`01-state-and-ownership.md`](01-state-and-ownership.md) | SSOT, desired/actual/ACK/snapshot/UI separation, identity, READY, unique writer, native-first planning, Capture admission, site routes |
| EPR-010..018 | [`02-operations-and-safety.md`](02-operations-and-safety.md) | irreversible operations, pure reads, transactions, selection, attribution, native lifecycle, hotkeys, UI contracts, visualizer leases |
| EPR-019..025 | [`03-runtime-and-quality.md`](03-runtime-and-quality.md) | restart/update recovery, structured errors, external boundaries, authenticated remote, privacy, performance, module direction |
| EPR-026..029 | [`04-process-and-quality.md`](04-process-and-quality.md) | browser-semantic tests, reversible delivery, truthful public copy, Git/AI gates |
| Regression map | [`05-problem-to-principle-map.md`](05-problem-to-principle-map.md) | historical failures mapped to durable acceptance criteria |

The repository documentation map is [`../README.md`](../README.md). SPECTRA and HALO architecture owners remain separate; this directory does not maintain a second capability matrix.
