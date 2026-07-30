---
type: reference
status: draft
audience: developer
owner: halo-product-and-engineering
last_reviewed: 2026-07-20
---

# HALO roadmap

This document owns sequencing and unresolved work. It does not define current runtime behavior; see [`architecture.md`](architecture.md) and executable registry/source/tests.

## P0: ownership closure

- finish taxonomy and registry as the sole plugin inventory;
- generate and verify the permission-usage map from plugin metadata;
- remove remaining manual Content-entry and active-service registration lists;
- make background-capable tools recover after service-worker suspension;
- verify generated outputs cannot drift from their sources.

## P1: release readiness

- complete the HALO public README, privacy policy, store listings, locale assets, screenshots, and release checks before public distribution;
- verify every shipped plugin's permissions, network behavior, retention, import/export, failure isolation, and cleanup;
- replace fixed tool/version counts with generated release evidence;
- define production-package integrity checks and browser smoke coverage;
- document unsupported browser surfaces and restricted-page behavior.

## P2: existing product workstreams

- complete prioritized existing tools before adding broad new categories;
- promote items from the [feature-gap backlog](research/feature-gap-analysis.md) only after owner, limits, permissions, lifecycle, i18n, tests, and release impact are explicit;
- close the [Hover Zoom proposal](proposals/hover-zoom-v2.md) through source/tests instead of historical checklist claims;
- treat [Bilibili danmaku](proposals/bilibili-danmaku.md) as optional and independently disposable.

## P3: separately reviewed network and AI capabilities

OCR, AI, cloud backup, translation providers, external validators, remote APIs, and synchronized state each require a separate decision covering:

- user problem and local alternative;
- permission and data-flow boundary;
- provider/model/package licensing;
- offline and failure behavior;
- cancellation, quotas, cost, retention, and deletion;
- security and privacy disclosures;
- production performance and maintenance exit strategy.

## Open architectural migrations

### Persistent background timers

Pomodoro, countdown, and similar tools need a Background-owned deadline model, browser-alarm recovery, persisted state, and a SidePanel projection. A mounted React component is not the clock authority.

### Generated Content entry

A plugin requiring Content execution must be discoverable from its manifest and generated into the Content entry. Manual imports are a migration state and should fail registry verification when they drift.

### Active-service projection

The active-service UI must derive from plugin lifecycle state rather than a manually maintained storage-key list. Each service exposes an owned status contract and disposer.

## Promotion gate

A roadmap item enters implementation only after it has:

1. one owner and user outcome;
2. bounded inputs/resources and cancellation;
3. permission, storage, network, and privacy behavior;
4. lifecycle, suspension, navigation, and disposal semantics;
5. i18n and accessibility surface;
6. focused and browser-level test plan;
7. architecture and release-projection impact.

Completion requires the full metadata → implementation → lifecycle/recovery → tests → documentation → production artifact chain. A version heading or checkbox is insufficient.
