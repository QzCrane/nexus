---
type: reference
status: draft
audience: contributor
owner: product-strategy
last_reviewed: 2026-07-20
---

# NEXUS portfolio roadmap

> Dependency direction: Contracts → Kernel → shared feature packages → SPECTRA / HALO

This document records portfolio sequencing. It does not prove that a feature has landed; current behavior is defined by contracts, source, tests, production artifacts, and domain owners.

## Current workstreams

### SPECTRA

- Architecture: [SPECTRA documentation](../../apps/extension-spectra/docs/README.md)
- Roadmap: [SPECTRA roadmap](../../apps/extension-spectra/docs/roadmap.md)
- Current focus: preserve the landed control architecture, close release-evidence gaps, and keep public claims aligned with browser boundaries.
- Candidate expansion: local AI audio/transcription only after a measured prototype, explicit CPU/memory/download budget, privacy review, model-license review, and product acceptance criteria.

### HALO

- Architecture: [HALO architecture](../../apps/extension-halo/docs/architecture.md)
- Roadmap: [HALO roadmap](../../apps/extension-halo/docs/roadmap.md)
- Current focus: registry/taxonomy and permission ownership, background lifecycle correctness, product-surface consolidation, and release readiness.
- Candidate expansion: prioritized tools only when lifecycle, permissions, storage, i18n, tests, registry metadata, and product documentation close in one change.

## 2026 milestone status

| Window | Original intent | Status as of 2026-07-20 | Required decision |
| --- | --- | --- | --- |
| Q1 | Establish HALO breadth and local-first performance baseline | Window elapsed; completion is not inferred from the date | Reconcile executable registry and release checks with the HALO owner set |
| Q2 | Prototype SPECTRA local AI features | Window elapsed; features remain proposals unless source/tests prove otherwise | Decide whether AI work outranks control and release closure |
| Q3 | Product hardening and ecosystem interoperability | Current planning window | Define typed inter-application contracts before sharing state or data |
| Q4 | Distribution, mobile, or cloud expansion | Uncommitted candidate | Require privacy, permissions, maintenance, operating-cost, and exit-strategy review |

## Portfolio gates

A milestone is complete only when all applicable layers agree:

```text
contract → implementation → tests → owner documentation → privacy/permissions → production artifact → release evidence
```

A roadmap checkbox, version heading, market note, or archived report cannot substitute for this chain.

## References

- [Documentation map](../README.md)
- [Engineering principles](../engineering/README.md)
- [Business model](business-model.md)
- [Research index](../research/README.md)
