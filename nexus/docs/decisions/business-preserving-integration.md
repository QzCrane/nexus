---
type: reference
status: stable
audience: contributor
owner: branch-integration-decision
last_reviewed: 2026-09-06
---

# Business-preserving branch integration

## Decision and source identities

Use current `main` (`664d0615f850c568a8840ac312ca7c92cb81ceee`) as the business baseline. Reconcile architecture (`7d4bf273130d73dbf63348affc3a258fcdac4627`) and total (`4b14658c107f33778bc5d48505609cafd58a0aec`) changes by mechanism, not by whole-file conflict preference. Their common ancestor is `24fd7631e6417bfe6416745c2eefcc4b950656f4`.

The complete candidate-path disposition is [integration-decisions.json](../../integration-decisions.json). It records source blobs, origin branches, disposition and reasons; it is not a second backlog. The existing [architecture task owner](../../architecture-closure.json) retains all 29 tasks and does not mark unexecuted product work complete.

## HALO business and data contract

The frozen [legacy baseline](../../apps/extension-halo/legacy-release-baseline.json) retains all 88 existing panel loaders and both packaged Bilibili scripts. Ruler, DOM selection, annotation, clipboard, smooth scrolling, user-script editing and existing system panels retain their execution surfaces. No persisted user-data keys or user enablement tombstones are removed. Legacy availability does not claim those features are mature or defect-free.

Four facts stay independent: declared maturity, physical release admission, persisted user enablement, and currently acknowledged runtime capability. Missing maturity becomes `unclassified`, not `ready`. New unreviewed modules are not physically admitted. Only fixed historical IDs may use the explicit `legacy` admission stage. Both source graph and generated resource projections protect this boundary. Current-main module state and lazy loaders remain single owners.

The Ruler-only / eight-panel branch payload is rejected as an unapproved product reduction. Smaller output from deleting capability is not a performance improvement. Inline UI motion declarations use inherited `--halo-motion-animation` and `--halo-motion-transition` variables, whose reduced-motion overrides preserve normal appearance while actually overriding inline timing without stylesheet suppression exceptions.

## SPECTRA runtime contract

Retain current-main acknowledged field control, remote protocol v3 and the owned PeerJS transport, per-site route/scale settings, capture admission tickets, current generation/revision classifier, single UI event hub and current teardown owners. The independent remote-site implementation is not rolled back.

Media discovery queries live tabs and passively probes exact documents with eight physical permits. Observer timeouts do not release an unresolved Chrome request's permit. One active scan is shared; finite query/probe/scan deadlines expose partial inventories instead of silently claiming completeness. Audible/recent verified media can seed the inventory; ordinary activation alone is not media evidence. Existing explicit pause-retention UI preference remains meaningful.

Card snapshots fence document identity before/after independent reads and are not represented as an atomic transaction. Background cards must not call full coordinator snapshots that wake the heavy runtime. Document replacement retires only the affected card and does not reload every card or discard settings. Late messages are checked against current browser-owned document identity and main's ordered lifecycle.

Optional grants preserve the synchronous permission gesture. Every matching pending click is stopped; replay is scoped to one current intent. Disposal, removed elements, changed card/session identity or changed hotkey definition retires old work. Permission grant does not replace main's execution-time target/document/capture validation.

Local diagnostics export bounded, validated owner summaries. Unreadable facts remain unknown, not success-shaped defaults. Port requests have deadlines and retirement cleanup; detached UI cannot download a late result. Diagnostics contain no intentionally collected tab URL/title/content, and token syntax checks are not claimed to universally detect secrets.

## Toolchain, dependencies and browser floor

Main already uses Bun 1.4.0, the native TypeScript 7.0.2 CLI and the separate `typescript-compiler-api` alias to TypeScript 6.0.2. Preserve those locks. The obsolete compatibility-prep plan is replaced with executable current-topology checks and a complete programmatic-import census. This integration does not retroactively claim historical TS6/TS7 diagnostic equivalence measurements.

Previously removed file-saver/jszip and misclassified dependency debt are not restored. Orphan type-package checks discover candidates independently of manual debt entries and respect peer/development targets. Historical upstream observations remain dated 2026-08-19; current lock bindings are separately dated 2026-09-06. Identical SBOM implementations are deduplicated. The one workflow-action validator owns immutable action references.

The inherited Chrome 135 archive checksum failed against the official archive. Two HTTPS acquisitions matched, the archive MD5 matched the GCS `x-goog-hash` header, and the official version metadata named the exact URL. [browser-floor.json](../../browser-floor.json) records the corrected SHA-256, original incorrect digest, storage generation and acquisition run. This is transport/artifact consistency evidence, not an independent publisher signature.

## Cost and evidence boundaries

All HALO production ceilings are unchanged from main. Retaining 88 panels and two scripts passes the original entry/startup/activation/chunk ceilings. SPECTRA's background closure stayed within the original 256 KiB ceiling by reusing its current narrow response validator rather than importing a second broad validator.

One deliberate budget change is Options: 40 to 41 KiB, supporting strict local diagnostic validation and retired permission-intent fencing. Measured integrated Options script closure is 41,392 bytes with Bun 1.4.0. Other SPECTRA absolute ceilings remain unchanged. Content runtime is close to its existing ceiling; passing a ceiling is not proof of ample growth headroom.

Before the remote integration checkpoint, local checks passed: six-workspace typechecking; strict lint; architecture verification; 132 governance tests and their production validators; 282 HALO tests including frozen-business and actual clipboard/Bilibili runtime fixtures; all 107 isolated SPECTRA unit files; both production builds. These measurements are working-tree evidence, not a claim that a different commit or remote CI passed.

Browser validation is a separate merge requirement. Local Chromium 144 did not load the extension worker. Chrome for Testing 135 starts the integrated extension, loads SidePanel/JSON Formatter and successfully executes lazy ruler activation in top and cross-origin child frames in a direct browser probe. The default Playwright suite has not yet completed reliably in this local environment. Do not replace that suite with the probe or record it green. Hosted exact-tree browser, production smoke, public-projection and same-feature performance/visual evidence remain required before release or main promotion.

No store publication, public-repository sync, original branch deletion or user-data migration is authorized implicitly by producing this integration candidate. Temporary private acquisition/replay workflows are excluded from the final product tree.
