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

Main already uses Bun 1.4.0, the native TypeScript 7.0.2 CLI and the separate `typescript-compiler-api` alias to TypeScript 6.0.2. Preserve those compiler and runtime versions; reviewed security repairs may change the exact dependency locks and must refresh their evidence. The obsolete compatibility-prep plan is replaced with executable current-topology checks and a complete programmatic-import census. This integration does not retroactively claim historical TS6/TS7 diagnostic equivalence measurements.

Previously removed file-saver/jszip and misclassified dependency debt are not restored. Orphan type-package checks discover candidates independently of manual debt entries and respect peer/development targets. Historical upstream observations remain dated 2026-08-19; current lock bindings are separately dated 2026-09-06. Identical SBOM implementations are deduplicated. The one workflow-action validator owns immutable action references.

The inherited Chrome 135 archive checksum failed against the official archive. Two HTTPS acquisitions matched, the archive MD5 matched the GCS `x-goog-hash` header, and the official version metadata named the exact URL. [browser-floor.json](../../browser-floor.json) records the corrected SHA-256, original incorrect digest, storage generation and acquisition run. This is transport/artifact consistency evidence, not an independent publisher signature.

## Cost and evidence boundaries

All HALO production ceilings are unchanged from main. Retaining 88 panels and two scripts passes the original entry/startup/activation/chunk ceilings. SPECTRA's background closure stayed within the original 256 KiB ceiling by reusing its current narrow response validator rather than importing a second broad validator.

One deliberate budget change is Options: 40 to 41 KiB, supporting strict local diagnostic validation and retired permission-intent fencing. Measured integrated Options script closure is 41,392 bytes with Bun 1.4.0. Other SPECTRA absolute ceilings remain unchanged. Content runtime is close to its existing ceiling; passing a ceiling is not proof of ample growth headroom.

## Executed failure closure and evidence

The first integration tree was not release-ready. Follow-up code checkpoints `9df643ebc42fbb49ee41628c6c7fe850afffbf9c` and `dab96e1a3b8b4eeb2b828af3def6634d9cc21393` retain the actual product repairs: acknowledged mute readback supplies real feedback; Action Popup sizing is separated from tab-hosted responsive layout; extension-owned Options tabs pass browser-owned sender validation; HALO theme text meets the contrast requirement; and abrupt Popup teardown releases observation leases through its owned port rather than assuming pagehide delivery. Late grants, duplicates, forged senders and post-disconnect work have negative tests. The Remote test compares the current observation generation while additionally checking that the physical processor and audio graph remain unchanged.

The canonical helper selects the Chrome-floor CDP driver explicitly, checks the exact executable version, and avoids contradictory extension flags. Chrome 135 Linux headless replay uses explicit GPU configuration; this is not evidence about desktop GPU performance. Browser performance identity comes from the actual browser, not reduced UA text. Node-hosted Playwright correctly records no Bun host version. The comparison requires equal runtime/browser identities, a common user-visible readiness predicate, actual production artifacts, all owned metrics and complete base/candidate workloads. Partial failure evidence is retained but never converted to a successful comparison.

At `1a864d0729cd4ec06bff04fbeb933390c0b24d88`, hosted documentation, HALO browser contracts, minimum Chrome, Windows/Linux quality and the full base/candidate comparison all passed. The exact comparison is Actions run `34028560811`, artifact `9987907454`, ZIP SHA-256 `9331c0e84ee7027535917e028ba53f6a1b93b9ea8c92567a73d84c4ee9496311`. It compares main `664d0615f850c568a8840ac312ca7c92cb81ceee` with that candidate on 20 metrics, 20 samples each. It is one independent run per revision, not proof of universal speedup or two release attempts.

That run recorded all-card bootstrap p50 113.619 to 77.987 ms, but visible-tab inventory p50 3.514 to 28.982 ms and Popup navigation-to-interactive p50 149.428 to 182.240 ms. Exact passive document discovery adds work relative to the old heuristic; the aggregate deltas must not all be attributed to a single cause. Retain the more complete business behavior and report this cost, rather than reverting paused-media discovery or asserting every path became faster. Long-session observations ended with zero Popup subscribers and zero renewal alarms. Artifact totals changed by +1,112 bytes for HALO and +24,315 bytes for SPECTRA. These values belong only to that measured revision; later lock changes require new comparisons.

Production SPECTRA smoke passed 40 tests and 361 assertions, the isolated suite passed 108 files, and HALO passed 284 tests plus its browser checks at the repair checkpoints. The local HALO release pipeline subsequently reached real dependency auditing and stopped on npm DNS failure. Neither that partial release run nor ordinary CI is the two-attempt exact-head release receipt required by [release closeout](../release-closeout.md). Visual candidate generation is not approval of a certified visual baseline. Main promotion requires its actual executable policy; no check, retry or budget is waived by this document.

## Repeat-run native route and closeout corrections

Repeating the same candidate exposed a real route bug: a hostname-wide negative
page-volume capability hint could override an acknowledged writer on the current
media target after a player mounted late. Current exact-target page-native
readback or an applied same-target acknowledgement now outranks that older hint.
The amplified write still requires its own matching acknowledgement; a capped
player still falls back to the capture processor. Both warm-acknowledgement and
fresh-readback cases are deterministic unit regressions, and the production
browser scenario explicitly seeds the stale negative hint before native
amplification and restores the fixture storage afterwards.

The authenticated Remote recovery scenario now resets through the canonical
`audio-reset` operation before testing low-level capture retirement. Resetting
only the Content projection leaves the coordinator's desired boost intact and
allows a subsequent Popup observation to legitimately reapply it. This repair
retains the exact stop-generation and offscreen cleanup assertions; it does not
hide a newer capture session by accepting any idle state.

The full release closeout exposed two verification defects not covered by ordinary
CI: Docker Go-template slice formatting failed despite a valid pinned image, and
the Git-free source archive was scanned as though it were a Git checkout. The
[closeout owner](../release-closeout.md) documents the JSON identity reader and
archive inventory. No release lane, required attempt, pinned image, production
budget or business capability is removed by these corrections.

## Observation and native-binding readiness barriers

A repeated Windows capture-recovery test exposed an effectful observer: opening
another Action Popup merely to read the audio session acquires and retires
visualizer/observation leases, so its returned generation may be superseded by
its own teardown. The recovery scenario now reads the browser-identified current
Content session without creating a Popup, samples Content, background session and
physical processor until their current generation agrees, and preserves exact
generation across the isolated worker restart. Physical capture calls and
processor identity must also remain unchanged. Actual volume and Remote actions
still use the real Action Popup. Tab-hosted Options is not granted permission to
impersonate another tab; the current-document RPC keeps its existing identity
checks.

The HALO minimum-browser replay also exposed a worker-target readiness race:
receiving a service-worker target is not proof that `chrome.storage` is usable.
All nine HALO browser entry paths now share one bounded readiness helper. It
selects only an extension background URL, verifies the same native runtime ID,
and waits for storage, messaging, tabs and permission bindings. Website workers,
wrong IDs and incomplete bindings fail their negative tests; actual evaluation
errors propagate. This does not suppress product failures or lengthen the
browser scenarios' deadlines.

## Security decisions following the real audit

Canonical quality CI now performs the actual advisory audit after both frozen dependency-domain installs, rather than only testing the audit validator. That exposed `fast-uri` 3.1.4 and `js-yaml` 4.3.0 in repository governance, and `extract-zip` 2.0.1 in the test-only Chrome-floor driver dependency chain. The compatible maintainer parser fixes resolve to 3.1.6 and 4.3.1. Root manifests are unchanged; Bun regenerated only those two root lock entries. Valid and invalid commitlint input, actual consumer resolution, international-domain normalization and ordered-map parsing were exercised.

The extractor had no patched release at this review. Keep `puppeteer-core` 24.7.2 as the Chrome 135 protocol driver, but explicitly share the already-used `@puppeteer/browsers` 3.2.1 manager through the product override. The old manager and `extract-zip` leave the lock; no unreviewed package versions are introduced. This is an intentional cross-major manager compatibility decision, not an upstream compatibility guarantee. The driver performs local executable replay, not arbitrary archive extraction. Minimum-Chrome, current-Chrome and same-workload performance CI must exercise the resulting lock. The override can be retired only when the floor driver is upgraded or removed with that compatibility evidence, not simply because newer metadata is available.

The advisory sources are GHSA-5jgf-p345-68v8, GHSA-5p4m-2wfm-xmqj and GHSA-jmr9-qjv8-65gv. Real root and product audit responses both returned empty advisory objects in Actions run `34029889848`; the resulting code checkpoint is `7dde956ae624e57db0ed6f32f1d3423fd0f5da68`. A clean advisory response describes that service and time, not proof that no vulnerability exists. The revalidation hash binds the new exact lock while preserving historical upstream observation dates and unchanged direct versions. No advisory suppression, scanner bypass, or removal of Chrome 135 support is accepted.

All repair work belongs in repository commits, not only in a local working tree. Temporary acquisition/checkpoint workflows are removed from the final candidate tree. No store publication, public-repository sync, original branch deletion or user-data migration is implied by this integration candidate.
