---
type: explanation
status: draft
audience: developer
owner: spectra-unified-control-runtime-v3
last_reviewed: 2026-08-29
---

# SPECTRA Unified Control Runtime V3 implementation ledger

This ledger records the authorized implementation of the
[Unified Control Runtime V3 proposal](unified-control-runtime-v3.md). It is a
progress and evidence record, not a second runtime authority. Executable
contracts, implementation, tests, artifacts, and the normative owners linked
from the [SPECTRA documentation entrypoint](../README.md) remain authoritative.

## Frozen boundary

- Baseline and `origin/main` at authorization:
  `24fd7631e6417bfe6416745c2eefcc4b950656f4`.
- Finding ledger: 40 named findings plus four P3 implementation/capacity
  findings in the
  [2026-08-27 audit](../_archive/2026-Q3/business-implementation-audit-2026-08-27.md).
- Authorized writes: SPECTRA contracts, implementation, tests, production and
  release gates, and directly affected normative/public projections inside the
  current NEXUS workspace.
- Not authorized: commit, push, merge, release, deployment, dependency install,
  global state, or any change under `halo-public-candidate-0.6.1/`.
- Pre-existing audit/proposal changes are owned by this repair and must not be
  reset while implementation proceeds.

## Cutover law

Each wave establishes its new owner and negative proof before migrating all
consumers and deleting the superseded writer. Long-lived dual write, fallback
to an old writer, permanent compatibility adapters, and test-only bypasses are
not accepted. A wave is complete only when focused behavior tests pass and no
known finding assigned to it remains.

## Wave ledger

| Wave | Scope | Finding groups | Acceptance | State |
| --- | --- | --- | --- | --- |
| W0 | exact-tree, dirty ownership, baseline, ledger | all | frozen boundary and protected paths recorded | complete |
| W1 | shared identity, protocol, errors, grants, leases, revisions | cross-cutting | strict validators and negative contract tests | local complete |
| W2 | Background tab control and lifecycle serialization | `CTL-002`, `PERF-003..005`, bounded fanout | navigation/commit interleavings and unique lease proof | local complete |
| W3 | Content document/source scopes and async fences | `CON-001..004` | source reuse, stale continuation, cancellation, and deadline proof | local complete |
| W4 | Popup, Side Panel, Options state and lifecycle | `UI-001..013`, `PERF-001..002`, UI P3 | ACK-driven rollback, lifecycle, semantics, and bounded bootstrap proof | local complete |
| W5 | Media WebAudio, Capture, graph transactions | `AUD-001..004`, `CTL-001`, `PERF-006` | admission, rollback, STOP, physical-owner, and allocation proof | local complete |
| W6 | Remote session authority | `REM-001..005` | epoch/replay, serialization, reconnect, and stale-await proof | local complete; deployment not authorized |
| W7 | update, artifact, locale, projection, capacity | `UPD-001`, `GATE-001..005`, budget P3 | typed graph, locale/projection negatives, hard production budgets; 15% headroom reported separately | local complete; advisory headroom remains |
| W8 | normative owners and stable candidate evidence | all | focused tests plus applicable repository/browser/release gates | local gates pass; exact-tree receipt/release replay pending |
| W9 | delete superseded owners and promote architecture truth | all | no dual owner, stale link, known failure, or unverified claim | blocked by W8 exact-candidate evidence and explicit authorization, not advisory headroom |

### W7 capacity closure ledger

This is the implementation order for
[the capacity closure architecture](unified-control-runtime-v3.md#1241-capacity-closure-architecture).
It records optimization work, not permission to relabel or hide bytes. The
per-entry numbers below are 15% headroom aims, not release ceilings; missing an
aim never permits weakening a live business path or failing an otherwise
applicable hard release gate.

| Step | Physical owner | Acceptance | State |
| --- | --- | --- | --- |
| W7.1 | Offscreen Audio boundary | processor-only START/UPDATE, batch-only visualizer, Capture script `<=24,371` | complete; canonical processor-contract leaf, 20,127 bytes |
| W7.2 | control/capability schema | one exhaustive compact data owner; audit views derived; guard parity | complete |
| W7.3 | realm contract compiler | deterministic worker/bootstrap/content/UI/Capture/Remote projections; no hand-written schema mirror | pending |
| W7.4 | Options settings boundary | canonical global/hotkey projection, same revision/CAS owner; Options `<=34,816` | complete; 34,146 bytes |
| W7.5 | Content/bootstrap owners | real physical code/guard reduction; no dynamic-edge accounting trick; all three Content targets pass | behavior complete; capacity deficits remain |
| W7.6 | Remote transport | pinned licensed JSON/DataChannel-only source shared by extension/public site; Remote `<=62,668` | complete; 50,505 bytes |
| W7.7 | QR | local interoperable bounded encoder; Popup `<=132,300` | implementation complete; Popup deficit 1,490 bytes |
| W7.8 | artifact total | report the advisory unique-JS/artifact headroom separately; every graph edge reachable and hard checker budgets pass | advisory headroom pending |

The W7.1 contract leaf is a startup-residency correction, not an aggregate-byte
claim. Together with removal of the SidePanel's unread duplicate Card config
and six dead UI exports, it removes 4,379 script bytes from the Capture-only
closure, 700 from Popup possible, and 4 from Content possible, while adding 132
bytes to the self-contained worker. Unique production JavaScript is 139 bytes
smaller than the immediately preceding same-tree artifact. The independently
governed Capture target now passes without hiding an edge or weakening a guard.

Background owner deferral is not admissible on the current minimum Chrome
platform because extension service workers cannot use dynamic `import()`.
Extension-page dynamic chunks may be evaluated only after W7.8 has enough
physical margin to absorb their overhead. Neither route can call a surface
complete while unique total bytes grow.

## User-visible closure

| Symptom | Root cause | Canonical repair | Executable proof |
| --- | --- | --- | --- |
| Visualizer enabled but no spectrum while native volume remained in `0..100`, and effective volume above 100 rolled back | Capture admission was coupled to DSP contribution, then the exact `targetTabId` API was shipped without the manifest `activeTab` authority Chrome requires | visible foreground visualizer demand is an independent exact-document `capture-observe` capability; the manifest declares temporary `activeTab` plus `tabCapture`, retains the explicit target, and still requires one-shot admission and host ACK | contract policy covers native volume 0/40/100; packaged permission readback and the admission test bind `activeTab` to the exact-target call; synthetic installed-Chrome tests cover analyser/ACK/release, while a visible-toolbar invocation remains the physical permission gate |
| One-card Popup retained Settings/multi-card height | the shared view shell owned a global 600px minimum and navigation added a second inline sizing authority | main mode is intrinsic; only `.settings-view-active` owns the 600px settings viewport; navigation only toggles the mode class | installed Chrome proves one card is below 600px with zero shell slack, Settings is at least 600px, and Back restores the original height |
| 390px Options audit overflowed after the settings projection cutover | a flex `<select>` retained its intrinsic minimum width inside the slot row | the flexible select owns `min-width: 0`, allowing its column to shrink without clipping controls outside the viewport | installed Chrome en-US/zh-CN layout and accessibility audit passes |

## Current local evidence

This evidence belongs to the current shared dirty working candidate. It proves
local implementation behavior; it is not a CandidateReceipt or release proof.

| Proof class | Result |
| --- | --- |
| Type closure | `bun run typecheck:spectra`: 4/4 packages pass |
| Strict lint | contracts 30 files, audio engine 7 files, and SPECTRA 341 files pass with zero diagnostics and zero silent handlers |
| Unit/contract | all 96 isolated SPECTRA unit, contract, and runtime files pass |
| Architecture | `bun run verify:v` passes v6; owner-aware verifier follows extracted canonical owners |
| Documentation | `bun run docs:check`: 99 Markdown files pass in strict mode |
| Repository/platform projections | toolchain, platform, governance, and public-projection checks pass |
| Production artifact | 84/84 reachable, zero duplicates, 618,332 JavaScript bytes and 709,960 total bytes; SHA-256 `6504eedd91e19794b8c94694583c808ec5e15adf750f72e3b474596e8a44ecf3` |
| Installed Chrome, en-US | 38/38 scenarios, 338 assertions; synthetic Capture/analyser coverage at native volume 0/40/100; one-card/settings/back geometry |
| Installed Chrome, zh-CN | 38/38 scenarios, 338 assertions; the same synthetic Capture/analyser, geometry, Remote, PiP-settlement, restart, and lifecycle matrix passes under a localized browser |
| Diff hygiene | `git diff --check` exits 0; CRLF notices are non-mutating Git conversion warnings |

The Chrome matrix includes cold defaults, configured-site arbitration, SPA and
page-native controllers, Popup/Options/Side Panel, visualizer zero-work,
synthetic Capture, the 0–800 acknowledged boundary, local PeerJS ESM lazy load,
Remote V3 HMAC/authenticated command delivery, shared offscreen ownership,
navigation/close cleanup, and service-worker/offscreen reconciliation.

## Open release boundary

- Every hard artifact ceiling passes, but current 15% headroom deficits remain.
  Remote and Options now pass their 15% targets; worker, bootstrap, lean host,
  Popup, Content and the two aggregate budgets remain blocked; Capture now
  passes through the canonical lightweight processor contract; see
  [runtime budgets](../architecture/runtime.md#production-performance-budgets).
- The working tree contains the integrated repair and protected unrelated
  `halo-public-candidate-0.6.1/`; no reset, staging, commit, push, merge, public
  sync, deployment, release, or cleanup was performed.
- No clean isolated source tree, CandidateReceipt, extracted ZIP replay, rollback
  drill, live PeerJS/STUN/TURN provider proof, promotion receipt, or independent
  promotion readback exists for this candidate.
- Remaining trace/model and expanded real-Chrome matrices from the proposal's
  definition of done remain release evidence, not facts inferred from the green
  local unit/browser lanes.
