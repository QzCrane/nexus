---
type: reference
status: stable
audience: developer
owner: spectra-product-and-engineering
last_reviewed: 2026-08-28
---

# SPECTRA proposals

Proposals define candidate architecture, explicit trade-offs, migration order,
and acceptance evidence. They do not prove current implementation or release
status and cannot override executable contracts or the normative owners linked
from the [SPECTRA documentation entrypoint](../README.md).

- [Unified Design 2026-10-28](unified-design-2026-10-28.md): the consolidated
  design scheme that indexes every existing owner — layered directories, runtime
  topology, the two-tier visual token model, the single-writer component matrix,
  the interaction pattern library, naming/comment/style conventions, and the
  verification map. It resolves the §7/§19 numeric-vs-tone conflict, records what
  was adopted or dropped from the 2026-10-26 design v4, and lists the remaining
  work and the conditions that invalidate it. Non-normative.
- [Unified Control Runtime V3](unified-control-runtime-v3.md): one coherent
  historical migration design for the 2026-08-27 business, lifecycle,
  performance, implementation, and release audit; its local-status statements
  are scoped to that repair candidate.
- [Unified Control Runtime V3 implementation ledger](unified-control-runtime-v3-implementation.md):
  historical exact-tree implementation waves, ownership boundaries, acceptance
  evidence, and cutover status for that authorized repair.

A proposal becomes current architecture only after the corresponding contracts,
implementation, tests, production artifacts, owner documents, and release gates
are changed together and the superseded owner paths are removed.
