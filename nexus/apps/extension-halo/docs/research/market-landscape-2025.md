---
type: explanation
status: archived
audience: developer
owner: halo-product-research
research_period: 2025
last_reviewed: 2026-07-20
---

# HALO market landscape (2025 evidence)

This document preserves durable problem hypotheses derived from 2025 research. Competitor user counts, prices, ratings, issue totals, browser behavior, and product policies are time-sensitive and were not revalidated during the 2026-07-20 documentation restructuring. Recheck primary store listings, official documentation, repositories, and current product behavior before using any dynamic claim for a release or investment decision.

The detailed legacy evidence remains in [`../../../../docs/_archive/market-research.md`](../../../../docs/_archive/market-research.md). This application summary records only durable problem hypotheses.

## Page appearance tools

Observed complaints centered on render cost, visual flash, compatibility, and configuration complexity. HALO's candidate response is early, reversible, site-scoped styling with a small default runtime and explicit compatibility fallbacks.

A CSS-first approach is not automatically correct for every page. It must preserve images/video, accessibility, print/PDF behavior, site-authored themes, and browser restrictions. Performance targets require current measurement on defined pages and hardware.

## Tab and session tools

The durable risks are data loss, silent storage failure, difficult recovery, and cross-device conflict. HALO should prioritize versioned local persistence, export/import, atomic writes, recovery testing, and explicit conflict semantics before optional synchronization.

`chrome.storage.sync` is capacity-limited and is not a complete backup system. A future Google Drive or other cloud path is an explicit network feature, not part of the local default.

## Screenshot and OCR tools

The product opportunity is local capture, editing, export, and optional local OCR without an upload-by-default service. The design must distinguish visible-tab capture, whole-page composition, protected browser pages, cross-origin frames, memory limits, and file-output behavior.

## QR and clipboard tools

Durable requirements are bounded permissions, local processing, input/output preview, history-retention controls, and protection against accidental handling of secrets. Clipboard access and URL opening require explicit user actions and clear failure states.

## Scrolling and focus tools

The problem is not only animation quality. A correct design must coexist with virtualized pages, editable controls, video shortcuts, nested scroll containers, accessibility settings, hidden SidePanel state, and browser lifecycle events.

## Website time limits

No browser extension can make a universal tamper-proof promise against switching browsers, profiles, devices, clocks, or uninstalling the extension. HALO may provide user-controlled friction and accountability, but public copy must not frame this as unbreakable enforcement.

## Product principles derived from the research

- local processing and local persistence by default;
- explicit opt-in and disclosure for network features;
- recovery and export before feature breadth;
- event-driven inactive state;
- narrow permissions owned by the invoking capability;
- measured performance rather than fixed “zero cost” or “10×” claims;
- simple default interaction with advanced controls only where they solve an evidenced problem.

## Evidence standard for future updates

For each competitor claim, record:

- source URL and source type;
- observation and publication date;
- product/browser/version and region;
- exact metric definition;
- whether it is direct evidence, a user report, or an inference;
- the strongest counterexample or alternative explanation;
- the HALO acceptance criterion derived from it.

Do not copy a market claim into the architecture owner. Convert only durable, tested consequences into architecture or product acceptance criteria.
