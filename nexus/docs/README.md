---
type: reference
status: stable
audience: contributor
owner: repository-documentation
last_reviewed: 2026-08-13
---

# NEXUS documentation

Canonical entrypoint organizing NEXUS documentation by **authority and lifecycle**.

## Authority Hierarchy
1. [`../../rules.md`](../../rules.md) (Repository-wide constraints)
2. Executable contracts, tests, build/release gates, and production artifacts
3. Domain owner documents (SPECTRA & HALO architecture, engineering principles)
4. Roadmaps and proposals
5. Dated research & decision evidence
6. READMEs, privacy policies, store listings, and public projections
7. Archived reports & Git history

## Key Owners & Navigation

- **Core & Governance**: [Engineering Principles](engineering/README.md) · [Release Closeout](release-closeout.md) · [Architecture Closure](architecture-closure.md) · [Portfolio Roadmap](product/roadmap.md) · [Business Model](product/business-model.md) · [Research Index](research/README.md) · [AI Hooks](../scripts/hooks/README.md) · [Skills](../../.agents/skills/README.md) · [Repository Rules](../../rules.md)
- **SPECTRA**: [Docs Entrypoint](../apps/extension-spectra/docs/README.md) · [Control Architecture](../apps/extension-spectra/docs/control/README.md) · [Runtime Architecture](../apps/extension-spectra/docs/architecture/runtime.md) · [Protocols](../apps/extension-spectra/docs/reference/protocols.md) · [Remote Security](../apps/extension-spectra/docs/security/remote-control.md) · [Roadmap](../apps/extension-spectra/docs/roadmap.md) · [Privacy](../apps/extension-spectra/PRIVACY.md) · [Store Listings](../apps/extension-spectra/store-listings/README.md)
- **HALO**: [Docs Entrypoint](../apps/extension-halo/docs/README.md) · [Architecture](../apps/extension-halo/docs/architecture.md) · [Roadmap](../apps/extension-halo/docs/roadmap.md) · [Research](../apps/extension-halo/docs/research/README.md) · [Proposals](../apps/extension-halo/docs/proposals/README.md) · [Privacy](../apps/extension-halo/PRIVACY.md) · [Store Listings](../apps/extension-halo/store-listings/README.md)

## Document Classes & Lifecycles

| Class | Purpose | Current Behavior Authority? |
| --- | --- | --- |
| `reference` | Contracts, architecture, protocols, indexes | Yes (when explicitly named owner) |
| `explanation` | Engineering principles and durable rationale | Yes (within scope) |
| `how-to` / `tutorial` | Operational procedures & learning paths | No |
| Roadmap / Proposal / Research | Work sequencing, design, & dated evidence | No |
| Projection / Archive / Mirror | Store copy, historical logs, compatibility mirrors | No |

- **Statuses**: `stable` (current), `draft` (unresolved), `archived` (immutable historical), `deprecated` (has `redirect_to` + date deadline).
- Enforced by `bun run docs:check`.

## Integration decisions

- [Business-preserving branch integration](decisions/business-preserving-integration.md) — source identities, business/data invariants, retained and rejected mechanisms, costs and evidence boundaries.
