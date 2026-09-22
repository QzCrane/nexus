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

- [`../_archive/market-research.md`](../_archive/market-research.md): legacy long-form HALO competitor research collected in 2025. Preserve as source material, but revalidate every dynamic number, price, policy, product capability, issue count, and user-count claim before using it in a current decision.
- [HALO research index](../../apps/extension-halo/docs/research/README.md): application-specific market and gap evidence.
- [SPECTRA archived evidence](../../apps/extension-spectra/docs/_archive/2026-Q3/README.md): dated implementation, regression, and release snapshots.
- [SPECTRA repeated 100–110 volume display stall](2026-09-23-spectra-volume-boundary.md): baseline diagnosis, evidence limits, and the continuous-feedback repair boundary.
- [SPECTRA test-value ledger](2026-09-23-spectra-test-value-ledger.md): frozen test census and KEEP/MERGE/REWRITE/DELETE disposition evidence for the cleanup wave.
- [SPECTRA control liveness follow-up](2026-09-23-spectra-control-liveness.md): post-reload hangs, bounded runtime reuse probes, and outstanding live-profile verification.

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
