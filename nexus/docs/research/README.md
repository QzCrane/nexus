---
type: reference
status: stable
audience: contributor
owner: product-research
last_reviewed: 2026-07-20
---

# NEXUS research

Research documents are dated evidence and hypotheses. They help choose what to build; they do not define current implementation, permissions, performance, compatibility, or release status.

## Current evidence sets

- [SPECTRA tab lifecycle and Popup closure 2026-11-02](2026-11-02-spectra-tab-lifecycle-popup-closure.md): dynamic card membership, immediate structure, physical observation order, retirement and scene-speed repair evidence.

- [`../_archive/market-research.md`](../_archive/market-research.md): legacy long-form HALO competitor research collected in 2025. Preserve as source material, but revalidate every dynamic number, price, policy, product capability, issue count, and user-count claim before using it in a current decision.
- [HALO research index](../../apps/extension-halo/docs/research/README.md): application-specific market and gap evidence.
- [SPECTRA archived evidence](../../apps/extension-spectra/docs/_archive/2026-Q3/README.md): dated implementation, regression, and release snapshots.
- [SPECTRA architecture audit 2026-10-26](2026-10-26-spectra-architecture-audit.md): consolidated state-machine audit — 67 registered findings (44 fixed, 22 revoked), five state machines, the fate of design v4, 15 invariants with current verdicts, G1–G8, and the open-item register. Replaces 14 documents that lived outside version control.
- [SPECTRA volume latency 2026-10-28](2026-10-28-spectra-volume-latency.md): root cause of the "bar does not follow the thumb" regression, per-millisecond latency budget, the 16.7ms / ~20ms physical floors, and the repair evidence. Supersedes the diagnosis below.
- [Dependency upgrade 2026-10-28](2026-10-28-dependency-upgrade.md): both dependency domains and the Bun runtime moved to the day's latest, with the two deliberate holds (`puppeteer-floor`, TS 6 compiler API), three pre-existing defects the upgrade exposed, and same-workload artifact deltas.
- [SPECTRA repeated 100–110 volume display stall](2026-09-23-spectra-volume-boundary.md): baseline diagnosis, evidence limits, and the continuous-feedback repair boundary. **Superseded by the 2026-10-28 entry** — the 2026-09-23 repair changed only the freeze trigger, not the value source.
- [SPECTRA test-value ledger](2026-09-23-spectra-test-value-ledger.md): frozen test census and KEEP/MERGE/REWRITE/DELETE disposition evidence for the cleanup wave.
- [SPECTRA control liveness follow-up](2026-09-23-spectra-control-liveness.md): post-reload hangs, bounded runtime reuse probes, and outstanding live-profile verification.
- [SPECTRA live and recorded media route isolation](2026-09-23-spectra-douyin-route-isolation.md): live-player target theft, hostname-rule collisions, and physical validation boundaries.

## Evidence contract

Every current research claim that affects prioritization records:

- observation date and geographic/product scope;
- primary source or reproducible dataset;
- metric definition and sampling method;
- whether the evidence is current, historical, inferred, or anecdotal;
- competing explanation and known selection bias;
- decision that the evidence supports;
- revalidation trigger.

Search snippets, copied marketing claims, unsourced review quotations, and point estimates without definitions are leads—not evidence.

## Lifecycle

- New evidence enters as `draft`.
- A decision memo may summarize validated evidence but links back to the source.
- Dynamic facts expire when their review window passes or the underlying product/policy changes.
- Historical evidence is archived rather than rewritten into current tense.
- An implementation owner never cites research alone as proof that behavior landed.
