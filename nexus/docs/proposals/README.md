---
type: reference
status: stable
audience: contributor
owner: architecture
last_reviewed: 2026-10-28
---

# Proposals

Repository-level proposals. A proposal states an intended architecture and its
verification plan; it is **not** a behaviour authority. Behaviour lives in the
executable contracts, tests, gates and produced artifacts.

- [Contract coherence architecture](contract-coherence-architecture.md) —
  why a field added to a type can invalidate every payload on the wire, the
  measured size of that structural risk, and the binding plus ratchet that make
  the two representations impossible to drift.
- [Open items program](open-items-program.md) — the eight unresolved items, where each
  sits in the architecture, how they constrain one another, and the four-wave order
  with a rollback condition per wave.
