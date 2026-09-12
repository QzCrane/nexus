---
type: reference
status: draft
audience: developer
owner: halo-product-and-engineering
last_reviewed: 2026-09-12
---

# HALO roadmap

This document owns sequencing and unresolved work. It does not define current runtime behavior; see [`architecture.md`](architecture.md) and executable registry/source/tests.

## v0.6.2 closed baseline

- the generated registry is the release identity and module inventory; source-folder size metadata is forbidden;
- required/optional/host permissions are checked against executable syntax, plugin ownership, and privacy headings;
- Clipboard defaults fail closed across runtime and UI projections;
- Hover Zoom settings and physical DNR rules reconcile through one Background owner;
- QR context-menu activation has monotonic dual-channel admission and is acknowledged only after exact payload persistence across SidePanel startup/remount boundaries;
- startup, lazy runtime, eventual SidePanel, largest-chunk, and per-tool activation-closure production budgets are executable release gates;
- public projection checks cover HALO as well as SPECTRA.

This heading is dated historical evidence. Current runtime behavior and the
live executable performance limits are owned by [`architecture.md`](architecture.md)
and `build.ts`; the former v0.6.2 byte ceilings must not be reused as current
release admission.

## Current remediation wave

- Timer and Pomodoro deadlines have moved to one Background alarm/revision
  coordinator; panels are projections and no longer determine completion by
  remaining mounted.
- Complex persisted tool values use domain codecs, invalid data is retained for
  explicit export or replacement, and quota decisions use native byte limits.
- API and TOTP sensitive drafts default to memory and enter the extension vault
  only after explicit save/readback; legacy deletion remains a separate action.
- Regex, PDF, Image Tools and RFC 9535 JSONPath use owned bounded task
  lifecycles; JSONPath, CSP and CSV behavior now follows the admitted semantic
  engines and explicit product boundaries in the architecture owner.
- Extension HTTP(S) admission validates every observable redirect and reports
  DNS destination as unknown where browser APIs cannot prove it.

These are implementation facts with focused tests. The final production build,
installed-Chrome semantic replay, hosted checks, release artifact and external
provider results remain separate evidence gates. Provisional bundle measurements
do not close those gates.

## P0: remaining ownership migrations

- remove remaining manual Content-entry and active-service registration lists through the generated owners below;
- make any feature intentionally expected to survive an unmounted SidePanel transfer to a Background/alarm owner;
- keep generated outputs read-only and fail release on source/projection drift.

## P1: release readiness

- maintain the HALO public README, privacy policy, localized store copy, reproducible screenshots, and release checks as one candidate projection;
- verify every shipped plugin's permissions, network behavior, retention, import/export, failure isolation, and cleanup;
- replace fixed tool/version counts with generated release evidence;
- define production-package integrity checks and browser smoke coverage;
- document unsupported browser surfaces and restricted-page behavior.
- before Chrome Web Store submission, revalidate the current Dashboard declarations and image requirements against primary sources and record the authenticated submission result separately from GitHub publication.

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
