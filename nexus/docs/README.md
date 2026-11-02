---
type: reference
status: stable
audience: contributor
owner: repository-documentation
last_reviewed: 2026-09-07
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

- **Core & Governance**: [Proposals](proposals/README.md) · [Engineering Principles](engineering/README.md) · [Release Closeout](release-closeout.md) · [Architecture Closure](architecture-closure.md) · [Portfolio Roadmap](product/roadmap.md) · [Business Model](product/business-model.md) · [Research Index](research/README.md) · [AI Hooks](../scripts/hooks/README.md) · [Skills](../../.agents/skills/README.md) · [Repository Rules](../../rules.md)
- **SPECTRA**: [Docs Entrypoint](../apps/extension-spectra/docs/README.md) · [Control Architecture](../apps/extension-spectra/docs/control/README.md) · [Runtime Architecture](../apps/extension-spectra/docs/architecture/runtime.md) · [Protocols](../apps/extension-spectra/docs/reference/protocols.md) · [Remote Security](../apps/extension-spectra/docs/security/remote-control.md) · [Roadmap](../apps/extension-spectra/docs/roadmap.md) · [Privacy](../apps/extension-spectra/PRIVACY.md) · [Store Listings](../apps/extension-spectra/store-listings/README.md)
- **SPECTRA 媒体控制与默认卡片**: [状态机与业务图目录](../apps/extension-spectra/docs/control/README.md#diagram-and-business-flow-index) · [成员资格与到期隐藏](../apps/extension-spectra/docs/control/06-media-and-video.md#131-document-level-inventory) · [全部卡片首帧与实际值确认](../apps/extension-spectra/docs/architecture/runtime.md#presentation-and-actual-confirmation) · [直播关闭与倍速继承规则](../apps/extension-spectra/docs/control/06-media-and-video.md#closing-live-players-and-speed-inheritance) · [媒体控制系统总览](architecture/2026-11-01-spectra-media-control-system-architecture.md) · [根因排查报告](research/2026-11-01-spectra-douyin-speed-sync-root-cause.md) · [实机探测运行手册](research/2026-11-01-spectra-douyin-speed-probe-runbook.md) · [官方适配器方案](proposals/2026-11-01-spectra-douyin-speed-official-adapter.md) · [全架构优化设计](proposals/2026-11-01-spectra-media-control-architecture-optimization.md)
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
- [Library reuse decisions](decisions/library-reuse.md) — all 56 selection directions, 82 tool-directory mappings, retained duties, sources and admission/acceptance limits; not a claim that candidate packages are installed.
- [Reuse-first execution and rework assessment](decisions/reuse-first-execution.md) — proactive selection boundary, preserved work, avoidable rework, implementation sequence and branch disposition.
- [Audit-to-reuse routing](../reuse-remediation-map.json) — complete mapping of the original 86 findings to reuse decisions and retained domain duties; [remediation status](../remediation-status.json) remains the only implementation-status owner.
