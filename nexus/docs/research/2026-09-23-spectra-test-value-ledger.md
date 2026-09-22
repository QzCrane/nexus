---
type: explanation
status: archived
audience: developer
owner: spectra-test-quality-audit
last_reviewed: 2026-09-23
---

# SPECTRA test-value ledger

Frozen baseline: `f14cb32163655bb9f049774e36fc4528bc3ab4c2` before this repair wave.
The tracked test tree contained 125 paths: 121 `*.spec.ts` files with 855
top-level `test`/`it` cases, plus one fixture and three helpers. The canonical
default runner owned 112 files/804 cases; nine Chrome, performance, or visual
files owned 51 cases. Shared Contracts and Audio Engine behavior was exercised
from the SPECTRA test directory; those packages had no separate test files.

Disposition question: if implementation changes in a realistically wrong way,
can this test catch it with an oracle independent from that implementation?
Source reads are not automatically weak: physical manifest, archive, artifact,
ZIP, CSP, generated-output, and golden-vector readbacks remain valid evidence.

## Applied dispositions

- **DELETE: 38 proven false or duplicate cases.** Five complete files were
  removed under this disposition: `audio-processor-contracts.spec.ts` (one
  deleted and one merged),
  `fresh-v2-senders.spec.ts` (5), `site-hotkey-exact-authority.spec.ts` (3),
  `site-hotkey-single-owner.spec.ts` (3), and
  `smoke-lifecycle-contract.spec.ts` (4). Seven further cases were removed:
  the accessibility test-of-test (1), circular control projection (1), and five
  lean-hotkey source-shape cases. Stronger owners are the audio graph contract,
  architecture verifier, real listener/owner tests, site transition tests, and
  real Chrome scenarios. Eight additional source-shape cases were removed from
  the offscreen contract (1), tab-capture permission contract (4), shortcuts
  (1), and hotkey action contract (2) after their invariants were assigned to
  executable protocol, handler, gesture, coordinator, or Chrome owners. The UI
  audit removed six more source-only cases, and the UI owner removed one frozen
  scalar-display helper case. A sixth complete file,
  `accessibility-contract.spec.ts`, was removed under MERGE rather than counted
  again as DELETE.
- **MERGE: fourteen duplicated cases.** One processor guard's missing field mutations moved
  into the existing executable `audio-graph-router` processor boundary. The
  structural import-owner mirror was already owned by `check-spectra-control`.
  Two popup geometry source cases merged into existing real-Chrome geometry
  coverage. Three accessibility source cases merged into the real-Chrome
  accessibility owner; the Content build-alias case merged into the canonical
  architecture verifier; four optional-permission wiring cases merged into the
  click-gate, handler, and Chrome owners; lazy QR loading merged into production
  dynamic-import closure evidence; and two Markdown mirrors moved to docs owners.
- **REWRITE: sixteen baseline cases.** Background message routing now registers and invokes
  the actual listener. Hung-query recovery now uses one tab so its 10 ms budget
  tests query coalescing/capacity release rather than an unrelated eight-tab
  scheduler race. One Capture permission baseline case now reads the physical
  manifest; its missing behavioral oracle was added as an assertion to an
  already-existing reconciliation case, so that strengthening is not counted as
  a second rewrite. Four mixed hotkey cases now test only executable descriptors, default
  chord resolution, disabled legacy state, and trusted-event guards. The UI
  owner rewrote three frozen popup-display expectations, and the Options owner
  replaced one source scan with failed-load behavior. The Content facade identity
  case now compares real module identities without inspecting its own imports.
  Three existing Smoke cases were rewritten after real Chrome disproved their
  storage-area, cold-inventory-listener, and denied-Capture host assumptions.
  A fourth now permits one final same-gesture speed correction to physical
  playback rate after release, while retaining immediate input and no restarted
  animation checks; the former assertion incorrectly froze the requested value.
- **CONSOLIDATE, not junk: 15 phase wrappers to two exhaustive tables.** One
  duplicate wrapper was removed, all 25 same-generation phase pairs and all
  newer/older generation pairs are covered, including the formerly absent
  `error -> active` and `error -> idle` positives.
- **ASYNC CONTRACT UPDATE, not junk:** four coordinator assertions now wait for
  the explicit session-projection drain after the ACK boundary was detached;
  Capture teardown drains the canonical audio-session and offscreen lifecycle
  barriers before restoring `chrome`.
- **EXCLUDED FROM BASELINE DISPOSITIONS:** the pagehide case was introduced and
  then replaced during this repair wave, so it is not baseline garbage. A new
  real Action Popup destruction test and typed Port tests are new coverage,
  not baseline garbage. The final Popup projection suite contains ten focused
  cases, including stale volume-result and DSP/broadcast barriers. Two new
  deferred-HELLO cases cover native observation handoff during cold startup.

Final physical inventory: 118 spec files; 108 belong to the default isolated
matrix and ten to explicit Chrome/performance/visual lanes. The real Chrome
Popup inventory benchmark was moved from the default matrix to the existing
`test:performance` command, preserving its two natural MV3 idle measurements.

## Reviewed source-backed boundaries retained

The remaining source or file reads have concrete independent ownership value:

- `content-runtime-readiness.spec.ts` is the startup-order specification. Runtime
  loader tests prove that Background waits for READY, but no other test observes
  the Content-side rule that initial policy hydration completes before READY.
- `i18n-assets.spec.ts` verifies the generated nine-locale physical outputs and
  the exact runtime consumers that make those URL-only assets reachable.
- `release-tooling.spec.ts` exercises real ZIP bytes, metafile closures, signed
  receipts, rollback points, HTTP redirects, MIME/CSP headers, and CLI ordering;
  its source reads are inputs to executable release failures rather than mirrors.
- `settings-value-normalization.spec.ts` executes normalization behavior and keeps
  the pure module boundary free of Chrome, storage, and repository dependencies.
- Remaining `ui-contracts.spec.ts` ownership belongs to the UI integration owner;
  this non-UI ledger does not reclassify those cases.

## Complete 121-file census

`KEEP` means no proven whole-file deletion. `DELETE`, `MERGE`, and `REWRITE`
record applied work. `CONSOLIDATE` preserves
the invariant with fewer, stronger cases.

- `accessibility-chrome.spec.ts` — KEEP
- `accessibility-contract.spec.ts` — MERGE into real-Chrome accessibility owner
- `audio-graph-router.spec.ts` — KEEP after docs-mirror merge
- `audio-handler.spec.ts` — KEEP
- `audio-host.spec.ts` — KEEP
- `audio-processor-contracts.spec.ts` — DELETE
- `audio-runtime-delegate.spec.ts` — KEEP
- `audio-session-phase.transitions.spec.ts` — CONSOLIDATE
- `audio-session-store.spec.ts` — KEEP
- `audio-v2-boundaries.spec.ts` — KEEP
- `background-message-routing.spec.ts` — REWRITE
- `background-rpc.spec.ts` — KEEP
- `badge-volume-state.spec.ts` — KEEP
- `bounded-card-bootstrap.spec.ts` — KEEP
- `bounded-fanout.spec.ts` — KEEP
- `capture-admission.spec.ts` — KEEP after exact-target behavior moved to Capture reconciliation
- `capture-manager.spec.ts` — KEEP
- `capture-policy.spec.ts` — KEEP
- `capture-reconciliation.spec.ts` — KEEP
- `card-snapshot.spec.ts` — KEEP
- `config-persistence.spec.ts` — KEEP
- `content-lifecycle.spec.ts` — KEEP
- `content-runtime-facade.spec.ts` — KEEP after verifier merge and identity rewrite
- `content-runtime-readiness.spec.ts` — KEEP startup-order structure contract
- `control-contracts.spec.ts` — KEEP after docs-mirror merge
- `control-coordinator-ack.spec.ts` — KEEP
- `control-coordinator-values.spec.ts` — KEEP
- `control-coordinator.spec.ts` — KEEP
- `control-operation-executor.spec.ts` — KEEP
- `control-snapshot-order.spec.ts` — KEEP
- `default-scalar-gesture.spec.ts` — KEEP
- `diagnostics-chrome.spec.ts` — KEEP
- `domain-contracts.spec.ts` — KEEP
- `eligibility-cache.spec.ts` — KEEP
- `extension-context.spec.ts` — KEEP
- `force-propagation.contract.spec.ts` — KEEP; merge-candidate historical file name
- `fresh-v2-senders.spec.ts` — DELETE
- `fullscreen-audio-handoff.spec.ts` — KEEP
- `hotkey-action-contract.spec.ts` — KEEP after source-shape fragments were removed
- `hotkey-target.spec.ts` — KEEP
- `i18n-assets.spec.ts` — KEEP generated output and URL-reachability contract
- `latest-keyed-intent.spec.ts` — KEEP
- `lean-hotkey-artifact-budget.spec.ts` — KEEP
- `lifecycle.spec.ts` — KEEP; merge-candidate tiny owner case
- `locale-concurrency.spec.ts` — KEEP
- `media-facts.spec.ts` — KEEP
- `media-registry.spec.ts` — KEEP
- `media-tab-discovery.spec.ts` — REWRITE
- `mode-executor-actual-config.spec.ts` — KEEP
- `native-media-async.spec.ts` — KEEP
- `native-media-executor.spec.ts` — KEEP
- `navigation-observer.spec.ts` — KEEP
- `offscreen-contracts.spec.ts` — KEEP after canonical-verifier duplicate deletion
- `offscreen-coordinator.spec.ts` — KEEP
- `optional-permission-admission.spec.ts` — KEEP physical manifest after four behavior-owner merges
- `optional-permission-click-gate.spec.ts` — KEEP
- `options-failure.spec.ts` — REWRITE by Options owner
- `options-settings-client.spec.ts` — KEEP
- `peerjs-data-only.spec.ts` — KEEP
- `peerjs-loader.spec.ts` — KEEP
- `performance.spec.ts` — KEEP
- `popup-coalescing.spec.ts` — REWRITE by UI owner
- `popup-document-projection.spec.ts` — KEEP
- `popup-inventory-latency.spec.ts` — KEEP
- `popup-session-authority.spec.ts` — KEEP after source negatives were removed from the actual-state behavior case
- `popup-startup.spec.ts` — KEEP after retired-EQ source duplicate deletion
- `popup-style-ownership.spec.ts` — KEEP after two source-only deletions and two geometry merges
- `popup-ui-event-hub.spec.ts` — KEEP
- `popup-volume-ux.spec.ts` — KEEP
- `protocol-mutation.spec.ts` — KEEP
- `qr-encoder.spec.ts` — KEEP; independent uqr golden vectors
- `registry.spec.ts` — KEEP
- `release-tooling.spec.ts` — KEEP executable physical release owner
- `remote-commands.spec.ts` — KEEP
- `remote-reconciliation.spec.ts` — KEEP
- `remote-security.spec.ts` — KEEP after lazy-closure merge
- `runtime-loader.spec.ts` — KEEP
- `runtime-long-session-performance.spec.ts` — KEEP
- `runtime-observation.spec.ts` — KEEP
- `runtime-restart-recovery.spec.ts` — KEEP
- `runtime-restart-startup.spec.ts` — KEEP
- `runtime-stress-performance.spec.ts` — KEEP
- `scalar-feedback.spec.ts` — KEEP after UI owner removed the frozen-display helper case
- `screenshot-handler.spec.ts` — KEEP
- `sentinel.spec.ts` — KEEP
- `serialized-queue.recovery.spec.ts` — KEEP
- `serialized-toggle.spec.ts` — KEEP
- `service-worker-wake-performance.spec.ts` — KEEP
- `session-current.spec.ts` — KEEP
- `settings-client.spec.ts` — KEEP
- `settings-projection-queue.spec.ts` — KEEP
- `settings-repository-stranded-legacy-routes.spec.ts` — KEEP; merge into repository owner when convenient
- `settings-repository.spec.ts` — KEEP
- `settings-value-normalization.spec.ts` — KEEP executable normalization and pure-boundary contract
- `settlement-pool.spec.ts` — KEEP
- `shortcuts.spec.ts` — KEEP after source-shape deletion
- `side-panel-footer.spec.ts` — KEEP
- `side-panel-speed.spec.ts` — KEEP
- `site-hotkey-exact-authority.spec.ts` — DELETE
- `site-hotkey-lean-host.spec.ts` — KEEP after source-shape deletion
- `site-hotkey-owner.spec.ts` — KEEP
- `site-hotkey-single-owner.spec.ts` — DELETE
- `site-hotkey-transition.spec.ts` — KEEP
- `smoke-lifecycle-contract.spec.ts` — DELETE
- `smoke.spec.ts` — KEEP real Chrome owner; REWRITE four stale behavioral oracles
- `spectra-client.spec.ts` — KEEP
- `spectra-protocol.spec.ts` — KEEP
- `sync-public.spec.ts` — KEEP
- `tab-capture-permission-contract.spec.ts` — KEEP physical manifest/policy evidence
- `tab-session.spec.ts` — KEEP
- `tab-visibility-chrome.spec.ts` — KEEP
- `tab-visibility.spec.ts` — KEEP
- `ui-contracts.spec.ts` — REVIEWED by UI integration owner
- `ui-runtime-contract.spec.ts` — KEEP
- `upgrade-manager.spec.ts` — KEEP
- `user-scripts.spec.ts` — KEEP
- `video-controls.spec.ts` — KEEP
- `video-effects-controller.spec.ts` — KEEP
- `visual-baseline.spec.ts` — KEEP
- `visualizer-subscriber-registry.spec.ts` — KEEP
- `webaudio-controller.spec.ts` — KEEP

## Validation evidence

- Cleanup-focused affected set: 74/74 passed.
- `control-coordinator.spec.ts`: 48/48 passed after explicit projection drain.
- `capture-reconciliation.spec.ts`: 10/10 passed; expected HELLO-failure logs remain,
  and the detached AudioSession `chrome is not defined` log is removed. One late
  offscreen-reconciliation log remains a separate offscreen lifecycle finding.
- `git diff --check -- nexus/apps/extension-spectra/test`: passed.

This document is an audit ledger, not current behavior authority. Contracts,
implementation, canonical verifiers, real Chrome evidence, and release gates
remain authoritative.
