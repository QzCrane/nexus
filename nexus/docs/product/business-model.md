---
type: explanation
status: draft
audience: all
owner: product-strategy
last_reviewed: 2026-07-20
---

# NEXUS business model

This document records commercial hypotheses. It is not a pricing commitment, revenue forecast, release plan, or proof that a proposed Pro feature exists.

## Non-negotiable product constraints

- No advertising business model and no sale of user data.
- No developer-operated analytics or telemetry unless an explicit future decision changes the privacy model and public disclosures first.
- Local processing and local settings remain the default.
- Optional network features are explicit opt-in capabilities with narrow data flow, authenticated access where applicable, and accurate privacy disclosure.
- Free functionality remains useful on its own; paid packaging cannot depend on degrading reliability or withholding security fixes.

“Local first” and “zero telemetry” do not mean “no network traffic.” SPECTRA's optional remote uses disclosed third-party signaling/STUN/TURN infrastructure, and a future HALO cloud backup would be a separate opt-in network feature.

## Packaging hypotheses

### Free and open core

Candidate scope:

- core media and productivity functions;
- local settings, import/export, and recovery;
- security and correctness fixes;
- enough capability to evaluate the product without artificial trial friction.

### Paid individual features

Candidates, subject to implementation and market validation:

- local AI processing whose runtime or support cost is materially higher;
- advanced customization and workflow automation;
- higher-capacity local data management;
- priority support or supported release channels.

### Family or team packaging

Candidates:

- shared license administration;
- optional synchronized configuration with explicit encryption and privacy boundaries;
- team policy, deployment, and support features.

### Enterprise offering

Candidates:

- self-hosted or administratively controlled deployment;
- SSO and policy enforcement;
- managed release cadence, audit evidence, and SLA-backed support.

## Pricing hypotheses

Previous candidate prices have not been validated here. Before setting prices, collect current competitor pricing, payment-platform costs, support burden, regional purchasing-power constraints, upgrade obligations, refund exposure, and expected paid-feature operating costs.

A lifetime license is especially sensitive to indefinite maintenance obligations. It requires an explicit version/support policy rather than an assumption that one payment funds permanent service.

## Features that must not be promised before implementation

- SPECTRA local vocal separation, transcription, recognition, or high-resolution export;
- cross-device synchronization beyond an approved privacy and conflict-resolution design;
- HALO cloud backup, OCR, AI search, or unlimited resource tiers;
- Cortex model access, summaries, or workflow automation while Cortex has no active application owner.

Plans may retain these as candidates, but pricing and store copy must not present them as delivered features.

## Decision gates

A paid capability is approved only after:

1. a user problem and target segment are evidenced;
2. the free/paid boundary is explicit and non-coercive;
3. implementation, maintenance, support, and third-party costs are modeled;
4. privacy, permissions, security, and data-retention behavior are reviewed;
5. cancellation, refund, migration, and service-discontinuation behavior are defined;
6. the capability passes the same contract, test, artifact, and documentation gates as free functionality.

## Metrics

DAU, conversion, revenue, and market-size numbers are scenario inputs, not facts. Every forecast states its source data, date, assumptions, acquisition cost, churn, payment fees, support cost, and confidence range. Unsupported point estimates do not become roadmap commitments.
