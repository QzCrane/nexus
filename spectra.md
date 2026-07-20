---
type: explanation
status: deprecated
audience: developer
last_reviewed: 2026-07-20
---

# SPECTRA legacy recovery specification

The former contents of this file were a 1,953-line recovery and implementation specification written before SPECTRA documentation was split into explicit owners. Keeping that text active created a competing authority containing historical bugs, proposed types, implementation instructions, and assertions that could drift from landed contracts.

The complete legacy text remains available in Git history before the documentation review branch. Do not restore or extend it as a current specification.

## Current normative entrypoints

- [Control architecture index](nexus/apps/extension-spectra/docs/control-architecture.md)
- [Runtime protocol](nexus/apps/extension-spectra/docs/protocols.md)
- [Runtime topology](nexus/apps/extension-spectra/docs/architecture.md)
- [Remote security](nexus/apps/extension-spectra/docs/remote-security.md)
- [WebAudio source admission](nexus/apps/extension-spectra/docs/cors-data-flow.md)
- [SCTRL invariants and release gates](nexus/apps/extension-spectra/docs/control/08-invariants-and-gates.md)

## Historical evidence

Dated regression, optimization, and implementation reports are indexed in [the 2026-Q3 archive](nexus/apps/extension-spectra/docs/_archive/2026-Q3/README.md). Historical reports preserve what was known and tested at their stated commit; they do not override current contracts or owner documents.

## Rule

New SPECTRA behavior belongs in exactly one domain owner, with corresponding contracts, implementation, tests, and release-gate evidence. This redirect contains no runtime requirements.