---
type: reference
status: stable
audience: contributor
owner: branch-integration-decision
last_reviewed: 2026-09-11
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


## Persistence settlement and domain-state repairs

Storage observation no longer retries an unfinished mutation or frees its physical
queue slot. A bounded area lane retains at most 64 queued/active operations and
16 MiB of encoded payload; excess admission fails visibly. The new write handle
reports committed, rejected or unknown, and exposes physical completion. Existing
boolean callers get false for unconfirmed outcomes, never a false success. These
limits are an explicit in-process queue envelope, not Chrome storage quotas and
not a cross-context transaction guarantee.

Reads distinguish unavailable/timeout from an absent key. Tool hooks wait for a
successful initial read before any draft write and preserve a changed draft on
retry. Persistence uncertainty has a mounted SidePanel alert and an explicit retry;
a slow physical operation keeps its authority until it really completes. Field
schemas remain domain-owned. Timer and Pomodoro normalize legacy missing anchors
to nullable JSON-safe timestamps, validate their fields, and never discard a pause
because an undefined property failed the shared storage contract. Background task
completion and full cross-context transactional ownership remain explicit open
items, rather than being inferred from these local repairs.

Clipboard admission preserves every pinned entry; a full pinned history rejects
new automatic text instead of dropping a pinned entry. Other transactional and
byte-budget history work is tracked separately. The test transport's command
wrapping was also corrected after an actual invocation printed Bun help with a
zero exit code. Retained checkpoint claims must distinguish focused tests that
ran from previous orchestration calls that did not execute their script owner.

## Conditional storage ledger for shared keys

Shared tool keys now support conditional read-modify-write through a kernel
storage ledger: each write carries a companion revision committed in the same
physical `set`, the stored value is verified after the write, and a detected
concurrent change is repaired by a bounded caller-supplied remerge instead of
becoming a silent lost update. `useToolState`, clipboard history, the session
list and archive metadata use this path. A degraded transport that drops the
revision key still commits by stored-value equality. This is optimistic
concurrency for those keys; it is not a cross-window transaction, plain
unledgered writes remain unconditional overwrites, and unrelated legacy keys
keep their previous behavior. The mechanism is the implemented boundary for
remediation items S01 and S05 and the cross-context part of S10, not a claim of
transactional storage.

Archive consistency is enforced by order and reconciliation rather than one
atomic store: blob first, metadata second, blob rollback when metadata cannot
commit, blob deletion for trimmed entries, and a bounded orphan sweep on panel
mount. IndexedDB helpers resolve only when the surrounding transaction
completes. The session manager persists one list only, restores pinned state in
both window paths, and reports per-tab restore results. Clipboard admission
adds an encoded byte budget with pinned-preserving eviction; session lists cap
entries and bytes while always retaining the newest session. These repairs are
focused regressions in `apps/extension-halo/test/storage-ledger.spec.ts`; they
do not complete the remaining domain schemas, budgets, or failure-surface work
tracked as S04, S06, and S07.

## Effect-time target binding and bounded network surfaces

Internal message routing now classifies senders once: UI-authority messages
require the trusted sidepanel sender, and tab-originated operations (clipboard
capture, the HoverZoom proxy, dynamic CSS injection) require the extension tab
sender category. Storage Editor mutations bind to the tab and origin captured
at scan time and re-verify the live tab origin when the effect happens; cookie
operations carry store, partition and host-only identity and target the cookie
own origin rather than the active tab. One fetch-budget owner bounds wall-clock
time and encoded response bytes and supports cancellation; the worker proxy and
the API tester use it, proxy transfers abort when their tab closes, and the
tester cancels on panel disposal. The proxy log records target hosts only.
Saved TOTP accounts, API tester config and responses retain their existing local
persistence. Automatic migration to session storage was rejected during branch
consolidation because browser restart would erase saved data; a future vault
requires an explicit retention and migration contract. Import drafts remain
ephemeral. The SSRF guard parses IPv4 literals per WHATWG forms before
pattern matching, narrows the overbroad benchmark range, and never blocks a
hostname for starting with numeric text. The guard still only evaluates the
initial URL literal; redirect and DNS-target safety is explicitly not claimed.
Focused regressions live in `apps/extension-halo/test/network-targets.spec.ts`.

## First-batch library-reuse admissions

The reuse-first decisions are now implemented for their first batch. Admitted
with exact versions in the HALO manifest and lockfile: PapaParse 5.7.0 (R01),
yaml 2.9.0 (R02), jsonc-parser 3.3.1 (R03), lossless-json 4.3.1 (R04),
sql-formatter 15.8.2 (R06), CSSO 5.0.5 (R09), @peculiar/x509 2.1.0 with
reflect-metadata (R15), marked 18.0.11 + DOMPurify 3.4.15 (R11/R12), entities
8.0.0 (R14), cron-parser 5.10.0 (R29). Each replaced engine was deleted; the
old regression vectors now run as adapter entrance vectors
(test/library-reuse-admission.spec.ts). Licenses are permissive, the advisory
audit responds clean, and every package has a shipped owner.

Deferred with recorded reasons: R05 JSONPath (pilot; the RFC 9535 compliance
harness is a precondition and the package was removed again), R07 Prettier and
R08 Terser (measured activation/total closure exceeds the production budgets;
hand formatters remain glue until a loading strategy fits), R28 jsdiff (the
committed bounded diff engine already caps memory; the package was removed).
The lazy-chunk budget was raised 1850 -> 2900 KiB and background 32 -> 40 KiB
with per-line accounting in build.ts: the growth is admitted engine weight and
reviewed security repairs, not silent drift. Per-chunk and activation ceilings
are unchanged. DOMPurify sanitizing semantics are verified in the real-browser
lane because a synthetic DOM does not faithfully resolve template parsing.

## Branch consolidation execution, 2026-09-11

The authorized delivery is to resolve useful work across the current Nexus
branches and merge the verified result into main. The initial clean implementation
head is `14e1dd67e470e6c0bc8226a77cc96958b338253b`; remote main remains
`664d0615f850c568a8840ac312ca7c92cb81ceee`. The source identities and historical
disposition in [reuse-first execution](reuse-first-execution.md) remain the
starting inventory, subject to fresh ancestry and content checks. This work does
not mark the separate remediation backlog complete.

Execution order: finish the branch-content census and independent review; repair
confirmed merge blockers on the implementation line; preserve its complete
history; normalize the final tree to the closeout owner's single-commit candidate;
run the required platform and two product attempts; then promote through the
canonical closeout command and read back remote main, PRs and local state.

The first local governance replay reproduced the current hosted failure: the
reuse-engine commit changed `bun.lock` without refreshing its exact observation in
`dependency-revalidation.json`. Refresh only that observed lock identity and date;
the older upstream observations keep their original date. The existing stale-lock
and stale-version regressions remain mandatory. Current toolchain and strict
documentation checks pass. All four initial hosted failures share this cause;
the repaired local governance suite passes 149 tests. Formal release status belongs
only to the closeout receipts for the final head; this document cannot waive them.

The branch census found no missing product work: architecture and total are
ancestors of the implementation head; the old candidate's complete tree
`00ea207461eab5b34264a4949aebd25eabba60a4` already appears at implementation
commit `49df809bd37672857c64189adfe4f7e69d68d38e`. The execution branch contains
only 20 transport files (2,321 lines across 26 commits); all five source trees
carried by those transports already appear in implementation history. Those
transport files are excluded from the delivered tree. Superseded refs are not
additional product work.

Independent review also rejected automatic session-only secret migration,
repaired missing restore-failure entries and storage-event revision adoption,
and replaced the custom XML serializer with the native full-document owner.
DTD input is preserved unchanged with a visible limitation; no hand-written DTD
parser is added. The XML choice follows the [DOM serialization contract](https://www.w3.org/TR/DOM-Parsing/)
and existing R10 selection. Real-browser tests cover saved data across restart,
cross-context revisions, delayed hydration followed by durable draft writes,
and XML fidelity including BOM prefixes. Ledger revisions belong to the same
key/area epoch as pending writes; stale-value rejection cannot discard the
revision needed by a newer local draft, or replace a newer storage observation.
N08 remains partial in the existing
remediation ledger; preserving retention is not a claim of an implemented vault.

Prevention stays in the current owners: pre-push executes the focused dependency
revalidation command, and the existing hook contract rejects missing, misplaced,
duplicated or filtered versions of that command. Hook structure uses
[Bun's native YAML parser](https://bun.sh/reference/bun/YAML/parse), replacing
text-only hook discovery. Lock observations are never auto-certified. The existing
cross-platform workflow can dispatch the canonical Linux platform recorder when
local Docker is unavailable, eliminating one-off execution branches. Canonical
atomic promotion and the already-enabled GitHub delete-on-merge setting own future
candidate cleanup; no parallel branch sweeper or disposition database is added.

The fresh hosted audit also detected [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh),
published to the advisory database on September 8, in the root commitlint ->
cosmiconfig -> js-yaml chain. Bun's targeted update changes only that transitive
lock entry from 4.3.1 to the compatible maintained fix 4.3.2. No direct dependency,
product lock, override or advisory suppression is added. Actual root and product
audit responses and commitlint's real configuration consumer are rechecked before
freezing the replacement candidate. Earlier exact-head receipts remain historical
and cannot authorize the changed tree.

Repeated browser replay exposed two missing test preconditions. Browser restart
now waits for both Home rendering and the navigation owner's physical storage
readback before closing Chrome. Hover Zoom's enabled-page checks wait for its
document-idle input listener and settings hydration through the existing
synchronous Alt-block contract over empty space. The readiness probe must request
no heavy runtime; the subsequent first real image-hover gesture still owns lazy
activation. No fixed sleep, gesture retry, force-click or product deadline change
substitutes for either boundary.

The second full product attempt exposed another timing assumption in the SPECTRA
OSD smoke workload: 19 physical keydowns do not guarantee a particular number of
completed writes before release. The existing burst owner intentionally discards
unstarted repeat pulses at keyup, while the foreground target animation is a
separate observation. The smoke now holds the same trusted key until native
media volume reaches zero, within a five-second failure boundary, then releases
and verifies the unchanged final frame and absence of a release tail. Its actual
volume assertion is strengthened from a timing-dependent range to exact zero;
the burst lifecycle, production behavior and display-window deadlines are unchanged.

A later Windows unit replay exposed a second static entry to the certificate
engine in its admission test. The production certificate owner already imports
the required metadata polyfill before the engine; the test also imported the
CommonJS engine as a sibling dependency, allowing it to load before that side
effect. The fixture now acquires its generator inside the asynchronous test,
after production-owner initialization. Bare engine import reproduces the missing
metadata error in a fresh process, while importing the production owner succeeds.
There is no global test preload, second initialization owner, dependency change
or production behavior change; Windows and Linux replay must verify the corrected
entry graph.

## Remaining-remediation execution, 2026-09-11

The user authorized completion of the remaining work after the verified
`c39b85a4f89d22ee37b592088b65c4c1bc5a5523` main settlement. Start from its clean
tree and reconcile all 42 non-implemented remediation records plus the overlapping
29 architecture tasks against current implementations and acceptance evidence.
The existing JSON owners retain status authority; this section records execution
order and decisions, not a second completion ledger.

Work proceeds through six bounded domains: release-policy/receipt/hosted authority
(G); persisted domain state and sensitive retention (S, N08); background deadlines
and effect-time target admission (J01/J02, N06/N11); SPECTRA discovery and internal
owner boundaries (D, related A); physical worker execution and resource retirement
(J05/J06/J10, U02); and CSV/JSONPath/CSP semantics (U07/U10/U20). Independent
read-only analysis precedes disjoint implementation; one integration owner controls
shared manifests, locks, generated surfaces, status records and final evidence.

Close records only when their original failure mode and acceptance boundary have
current evidence. Preserve saved user data, reject silent partial semantics, and
use native or already admitted owners before new dependencies. Functional repairs
include their necessary permission/privacy projections. Final release proof is
produced after the complete candidate is frozen; then reconcile hosted evidence,
promote main, and remove the task's candidate ref and temporary artifacts.

The implementation wave now uses explicit domain codecs or existing domain
normalizers for all 163 HALO `useToolState` calls (86 plain text/boolean,
71 codecs, 6 normalizers). The Compiler API gate derives disjoint counts from
resolved calls rather than a manual allowlist. Invalid data is retained for
recovery; sensitive drafts require explicit vault persistence. Background
deadlines, native single-use Workers, effect-time target admission and SPECTRA
document generations have focused regression coverage. These are authoring
observations; installed-browser and frozen release results remain separate.

The user explicitly admitted `@swaggerexpert/jsonpath@4.0.4` and
`csp_evaluator@1.1.8`. The product lock adds exactly those packages plus JSONPath's
`apg-lite@1.0.5` dependency. Compact admission evidence is retained in
`../_archive/audits/semantic-admission-2026-09-11.json`; the final production
dependency/NOTICE/ZIP chain is generated by each canonical release owner.

Formal closeout now plans required hosted jobs from current workflows, reads
complete run/job inventories and actual checkout log identities, and preserves
full attempt/platform records through one immutable Git note per candidate.
Provider protection/ruleset reads remain externally unknown because this private
repository's plan returns HTTP 403. Neither local gates nor the Git note is
described as independently enforcing provider permissions.
