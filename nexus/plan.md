---
type: reference
status: draft
audience: contributor
last_reviewed: 2026-07-20
---

# NEXUS portfolio roadmap

> Dependency direction: Contracts → Kernel → shared feature packages → SPECTRA / HALO

This file records portfolio sequencing. It does not prove that a feature has landed; current behavior is defined by contracts, source, tests, and the domain owner documents.

## Current workstreams

### SPECTRA

- Current owner: [control architecture](apps/extension-spectra/docs/control-architecture.md)
- Roadmap: [SPECTRA plan](apps/extension-spectra/plan.md)
- Current focus: preserve the landed control architecture, close release-evidence gaps, and keep public claims aligned with actual browser boundaries.
- Candidate expansion: local AI audio/transcription features only after a measured prototype, explicit resource budget, privacy review, and product acceptance criteria.

### HALO

- Current owner: [HALO architecture and roadmap](apps/extension-halo/plan.md)
- Current focus: registry/taxonomy and permission ownership, background lifecycle correctness, and release-readiness documentation.
- Candidate expansion: complete prioritized tools only when their lifecycle, permissions, storage, i18n, tests, and registry metadata close in one change.

## 2026 milestone status

| Window | Original intent | Status as of 2026-07-20 | Required decision |
| --- | --- | --- | --- |
| Q1 | Establish HALO breadth and local-first performance baseline | Window elapsed; do not infer completion from the date | Reconcile the HALO owner document with executable registry and release checks |
| Q2 | Prototype SPECTRA local AI features | Window elapsed; features remain proposals unless source/tests prove otherwise | Decide whether AI work outranks control/release closure |
| Q3 | Product hardening and ecosystem interoperability | Current planning window | Define a typed inter-application contract before sharing data or runtime state |
| Q4 | Distribution, mobile, or cloud expansion | Uncommitted candidate | Require a privacy, permission, maintenance, and operating-cost review before approval |

## Portfolio gates

A milestone is complete only when all applicable layers agree:

```text
contract → implementation → tests → owner documentation → privacy/permissions → production artifact → release evidence
```

A roadmap checkbox, version heading, market note, or archived report cannot substitute for this chain.

## References

- [Documentation map](docs/documentation-index.md)
- [Engineering principles](docs/engineering-principles.md)
- [Business model](docs/business-model.md)
- [SPECTRA control architecture](apps/extension-spectra/docs/control-architecture.md)
- [HALO owner](apps/extension-halo/plan.md)