---
type: reference
status: stable
audience: contributor
owner: repository-documentation
last_reviewed: 2026-07-20
---

# NEXUS documentation

This directory is the canonical entrypoint for NEXUS documentation. It organizes documents by **authority and lifecycle**, not by whichever task created them.

## Directory model

```text
docs/
├── README.md                         # this authority map
├── engineering/
│   └── README.md                     # EPR index and engineering doctrine
├── principles/                       # current EPR definitions (compatibility location)
├── product/
│   ├── roadmap.md                    # portfolio sequencing and delivery gates
│   └── business-model.md             # commercial hypotheses and constraints
├── research/
│   └── README.md                     # dated evidence and revalidation rules
├── market-research.md                # legacy long-form evidence; not current truth
└── documentation-index.md            # deprecated path alias during migration
```

Application documentation remains collocated with the application:

```text
apps/extension-spectra/docs/
apps/extension-halo/docs/
```

Operational documentation remains beside the executable system it explains. Agent workflows and public release projections remain beside their own sources rather than being copied into this directory.

## Authority order

When written sources conflict, use this order:

1. [`../../rules.md`](../../rules.md): repository-wide workflow, security, dependency, environment, test, and Git constraints.
2. Executable contracts, source, tests, build/release gates, and the production artifact.
3. The domain owner documents listed below.
4. Roadmaps and proposals.
5. Research and dated decision evidence.
6. README, privacy, permission, and store-copy projections.
7. Archived reports and Git history.

A lower layer may summarize or link upward. It must not copy a complete policy matrix or redefine behavior.

## Repository owners

- [Engineering principles](engineering/README.md)
- [Portfolio roadmap](product/roadmap.md)
- [Business model](product/business-model.md)
- [Research index](research/README.md)
- [AI-tool hook architecture](../scripts/hooks/README.md)
- [Agent workflow sources](../../.agents/skills/README.md)
- [Root contributor rules](../../rules.md)
- [Workspace entrypoint](../README.md)

## SPECTRA owners

- [Documentation entrypoint](../apps/extension-spectra/docs/README.md)
- [Control architecture](../apps/extension-spectra/docs/control/README.md)
- [Runtime architecture](../apps/extension-spectra/docs/architecture/runtime.md)
- [Wire protocols](../apps/extension-spectra/docs/reference/protocols.md)
- [Remote security](../apps/extension-spectra/docs/security/remote-control.md)
- [Media WebAudio admission](../apps/extension-spectra/docs/architecture/media-source-admission.md)
- [Roadmap](../apps/extension-spectra/docs/roadmap.md)
- [Historical evidence](../apps/extension-spectra/docs/_archive/2026-Q3/README.md)
- [Product README](../apps/extension-spectra/README.md)
- [Privacy policy](../apps/extension-spectra/PRIVACY.md)
- [Store-copy contract](../apps/extension-spectra/store-listings/README.md)

## HALO owners

- [Product entrypoint](../apps/extension-halo/README.md)
- [Documentation entrypoint](../apps/extension-halo/docs/README.md)
- [Architecture](../apps/extension-halo/docs/architecture.md)
- [Roadmap](../apps/extension-halo/docs/roadmap.md)
- [Research](../apps/extension-halo/docs/research/README.md)
- [Proposals](../apps/extension-halo/docs/proposals/README.md)

## Document classes

| Class | Purpose | May define current behavior? |
| --- | --- | --- |
| `reference` | contracts, architecture, protocols, indexes | yes, only when explicitly named as owner |
| `explanation` | rationale and durable engineering principles | yes, within its declared scope |
| `how-to` | operational procedures | no; must follow owners and executable scripts |
| `tutorial` | learning path | no |
| roadmap/proposal | sequencing and unresolved design | no |
| research | dated evidence and hypotheses | no |
| public projection | README/privacy/store copy | no; must remain narrower than verified behavior |
| archived | historical evidence | no |
| deprecated redirect | temporary path compatibility | no |
| generated compatibility mirror | byte-identical executable path compatibility | no; canonical owner is the only edit source |

## Lifecycle rules

- `stable`: current and maintained.
- `draft`: unresolved or proposed; never proof of completion.
- `archived`: immutable historical evidence.
- `deprecated`: compatibility alias with `redirect_to` and a removal date.

A document move is complete only when the canonical index, inbound links, executable consumers, and compatibility projections are updated together. Deprecated redirects contain no normative content and are removed after their announced migration window. A generated compatibility mirror exists only when an executable consumer still requires the former path; the documentation gate verifies byte equality with the canonical owner and rejects independent edits.

## Structural quality gates

The documentation checker must enforce:

- required frontmatter for active internal docs;
- one H1 per document;
- exact-case valid local relative links;
- valid deprecated redirects;
- byte-identical registered compatibility mirrors;
- no duplicate stable owner for one domain;
- Bun toolchain references pinned to `1.3.14`;
- no active document orphaned from a documentation entrypoint;
- no roadmap, proposal, research note, or archive presented as implemented truth.

Dynamic facts—versions, prices, competitor counts, browser policies, external APIs, and network providers—must be revalidated from current primary sources before they drive a decision or release.