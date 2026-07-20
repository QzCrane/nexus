---
type: reference
status: stable
audience: contributor
last_reviewed: 2026-07-20
---

# NEXUS documentation map

This file is the canonical map for Markdown ownership. It classifies documents by purpose and prevents a README, roadmap, market note, archived incident report, store listing, or agent skill from becoming an accidental architecture authority.

## Authority order

When two documents conflict, resolve the conflict in this order:

1. [`../../rules.md`](../../rules.md): repository-wide workflow, security, environment, dependency, test, and Git constraints.
2. Executable contracts, source, tests, and release gates: the implementation truth that documentation must match.
3. Domain owner documents listed below: normative product and architecture semantics.
4. Plans and research: proposed work and decision evidence; never proof that a capability has landed.
5. README, privacy, and store copy: user-facing projections of verified behavior.
6. Archived reports and Git history: historical evidence only.

A lower layer may explain or link to a higher layer. It must not duplicate a complete policy table or silently redefine behavior.

## Repository and workspace entrypoints

- [`../../README.md`](../../README.md): repository layout, commands, and navigation.
- [`../README.md`](../README.md): workspace architecture and application entrypoints.
- [`../plan.md`](../plan.md): current portfolio roadmap and milestone status.
- [`engineering-principles.md`](engineering-principles.md): EPR index and cross-project engineering rules.
- [`principles/01-state-and-ownership.md`](principles/01-state-and-ownership.md): EPR-001..009.
- [`principles/02-operations-and-safety.md`](principles/02-operations-and-safety.md): EPR-010..018.
- [`principles/03-runtime-and-quality.md`](principles/03-runtime-and-quality.md): EPR-019..025.
- [`principles/04-process-and-quality.md`](principles/04-process-and-quality.md): EPR-026..029 and release checks.
- [`principles/05-problem-to-principle-map.md`](principles/05-problem-to-principle-map.md): regression-to-principle traceability.
- [`business-model.md`](business-model.md): commercial hypotheses and non-negotiable privacy constraints.
- [`market-research.md`](market-research.md): dated historical market evidence; revalidate before current decisions.

## SPECTRA normative owners

- [`../apps/extension-spectra/docs/control-architecture.md`](../apps/extension-spectra/docs/control-architecture.md): sole control-architecture entrypoint.
- [`../apps/extension-spectra/docs/control/01-foundations.md`](../apps/extension-spectra/docs/control/01-foundations.md): product semantics and state ownership.
- [`../apps/extension-spectra/docs/control/02-strategy-and-routes.md`](../apps/extension-spectra/docs/control/02-strategy-and-routes.md): strategy order, route registry, runtime readiness, site adapters, PiP, and fullscreen.
- [`../apps/extension-spectra/docs/control/03-ui-and-boundaries.md`](../apps/extension-spectra/docs/control/03-ui-and-boundaries.md): UI, loading, privileged boundaries, and failure-directed escalation.
- [`../apps/extension-spectra/docs/control/04-algorithm-matrix.md`](../apps/extension-spectra/docs/control/04-algorithm-matrix.md): algorithm-matrix entrypoint.
- [`../apps/extension-spectra/docs/control/04a-algorithm-matrix.md`](../apps/extension-spectra/docs/control/04a-algorithm-matrix.md): exhaustive capability matrix.
- [`../apps/extension-spectra/docs/control/04b-source-algorithms.md`](../apps/extension-spectra/docs/control/04b-source-algorithms.md): audited source algorithms and dispositions.
- [`../apps/extension-spectra/docs/control/05-control-state.md`](../apps/extension-spectra/docs/control/05-control-state.md): field state, volume, mute, and audio processing.
- [`../apps/extension-spectra/docs/control/06-media-and-video.md`](../apps/extension-spectra/docs/control/06-media-and-video.md): media identity, media controls, video effects, and screenshots.
- [`../apps/extension-spectra/docs/control/07-runtime-and-performance.md`](../apps/extension-spectra/docs/control/07-runtime-and-performance.md): loading topology, implementation ownership, and runtime costs.
- [`../apps/extension-spectra/docs/control/08-invariants-and-gates.md`](../apps/extension-spectra/docs/control/08-invariants-and-gates.md): SCTRL invariants and release gates.
- [`../apps/extension-spectra/docs/protocols.md`](../apps/extension-spectra/docs/protocols.md): cross-context wire and lease protocol.
- [`../apps/extension-spectra/docs/architecture.md`](../apps/extension-spectra/docs/architecture.md): runtime-context topology and ownership.
- [`../apps/extension-spectra/docs/remote-security.md`](../apps/extension-spectra/docs/remote-security.md): pairing, authentication, session binding, and network disclosure.
- [`../apps/extension-spectra/docs/cors-data-flow.md`](../apps/extension-spectra/docs/cors-data-flow.md): irreversible WebAudio source-admission boundary.

## SPECTRA planning and public projections

- [`../apps/extension-spectra/plan.md`](../apps/extension-spectra/plan.md): roadmap and unresolved work; not a current-behavior owner.
- [`../apps/extension-spectra/README.md`](../apps/extension-spectra/README.md): product overview and developer entrypoint.
- [`../apps/extension-spectra/PRIVACY.md`](../apps/extension-spectra/PRIVACY.md): public privacy disclosure.
- [`../apps/extension-spectra/store-listings/README.md`](../apps/extension-spectra/store-listings/README.md): canonical store-copy constraints and locale maintenance.
- [`../apps/extension-spectra/store-listings/privacy-justifications.md`](../apps/extension-spectra/store-listings/privacy-justifications.md): permission and data-use declarations.
- [`../apps/extension-spectra/docs/_archive/2026-Q3/README.md`](../apps/extension-spectra/docs/_archive/2026-Q3/README.md): historical implementation and regression evidence.
- [`../../spectra.md`](../../spectra.md): deprecated redirect retained for old links; no normative content.

## HALO owners, plans, and research

- [`../apps/extension-halo/plan.md`](../apps/extension-halo/plan.md): HALO architecture and current roadmap owner.
- [`../apps/extension-halo/docs/research.md`](../apps/extension-halo/docs/research.md): dated market hypotheses.
- [`../apps/extension-halo/docs/feature-gap-analysis.md`](../apps/extension-halo/docs/feature-gap-analysis.md): product gap backlog, not verified capability state.
- [`../apps/extension-halo/docs/plan-hover-zoom-v2.md`](../apps/extension-halo/docs/plan-hover-zoom-v2.md): Hover Zoom workstream plan and historical notes.
- [`../apps/extension-halo/docs/plan-danmaku.md`](../apps/extension-halo/docs/plan-danmaku.md): Bilibili danmaku design proposal.

HALO has no separate `docs/architecture.md`. Architecture belongs to `apps/extension-halo/plan.md`; do not recreate a second owner.

## Remote site, agent skills, and operational documentation

- [`../../remote-site/README.md`](../../remote-site/README.md): remote-site deployment and byte-identical release gate.
- [`../../.agents/skills/README.md`](../../.agents/skills/README.md): skill index.
- `../../.agents/skills/*/SKILL.md`: task workflows; update their source or synchronization process instead of manually creating mirrors.
- [`../scripts/hooks/README.md`](../scripts/hooks/README.md): AI-tool hook architecture, testing, and debugging.

## Review result as of 2026-07-20

The repository-wide review found and corrected these failure classes:

- links to nonexistent `AGENTS.md`, `CLAUDE.md`, and HALO `docs/architecture.md`;
- wrong-case or wrong-directory links to HALO/SPECTRA plans, READMEs, and archived reports;
- stale links to anchors removed when SPECTRA control architecture was split;
- conflicting counts for 50 versus 51 control capabilities;
- a 31-band roadmap claim conflicting with the canonical 10-band DSP contract;
- plans presented as stable architecture or as proof of completion;
- stale quarter labels and unqualified market/pricing projections;
- malformed Markdown in the SPECTRA changelog;
- store copy claiming zero CPU, universal compatibility, protected-media reliability, implicit limiting, or guaranteed success beyond browser security and activation boundaries;
- a legacy 1,953-line SPECTRA recovery specification competing with the current owner set.

## Maintenance rules

- Give every active internal document Diátaxis frontmatter with one `type`, one lifecycle `status`, and an `audience`.
- Put dates on research, plans, audits, and verification snapshots; do not put dates on timeless contract definitions unless they identify a release baseline.
- Do not hard-code inventory counts in navigation documents when an executable registry or contract owns the count.
- Keep current behavior in one domain owner. Keep incidents and test numbers in dated archive reports.
- Treat relative links as release-gated interfaces: rename or move a document only with all inbound links updated in the same change.
- Revalidate competitor counts, prices, browser-store policies, APIs, and network-provider facts before using them in a current decision or release.
- Public claims must be no stronger than the verified contracts, production artifact, privacy policy, and browser integration tests.