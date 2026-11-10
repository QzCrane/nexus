---
type: explanation
status: draft
audience: developer
owner: spectra-control-architecture
last_reviewed: 2026-11-07
---

# Live volume regression audit — 2026-11-05

## 2026-11-07 acceptance reopened: purpose versus actual regression

### Renewed stale-source report: bounded native-volume continuation

Follow-up user readback: control works after the rebuilt dist, but first
open/refresh is slow; later gestures are normal. The user also disputes the
below-100 Capture behavior. These remain separate acceptance boundaries.

Cold loading now has a proven repair: `runtime-loader.loadRuntime` omitted
`injectImmediately`, so Chrome's default document-idle scheduling held the first
control behind unrelated page loading. A built-browser test holds a parser-blocking
script indefinitely while an earlier video is available. Before the change,
the control remains pending until the script is released; after the change,
the physical volume becomes 0.4 while `readyState` is still `loading`. Exact-document
targeting, lease admission, READY and cancellation are unchanged. The four browser
source/restart/cold-load cases and 23 runtime-loader tests pass.

Huya route evidence must not be generalized away: `nativeAudioAbsent/documentOutput`
was added in dirty work after HEAD and is absent from local main. It can initiate
Capture below 100 and remains active until release, even if the presentation later
changes back to an ordinary native source. The initial public timing probe measured
437 ms for the first Capture control and 52–211 ms for subsequent controls; an
immediate-reload probe measured 569 ms. These runs did not reproduce the user's
long wait; the held-page-script test supplies that independent reproduction.

For a public video-only Huya sample, direct native volume zero leaves nonzero RMS
0.051492. The product Capture oracle previously measured zero at requested zero.
The preserved main artifact's Popup operation was rejected by its older invocation
admission on Chrome 157, so that trial does not certify main end-to-end volume.
Only the direct native audio measurement is usable from it. The user subsequently
reaffirmed the existing business rule: control the broadcast, not the advertisement;
do not import the ad's mute/zero into broadcast preferences. This is not authorization
to redesign the scale or a request to choose between Capture and broken control.
The separated-output Capture mechanism remains distinct from main and must be
reported as such; whole-document output does not prove isolated control of two
simultaneously audible independent programmes.

The live/ad regression is reproduced and repaired through the existing registry:
the old built artifact applied 40 to a finite advertisement while leaving the
smaller live stream at zero and muted. Shared ranking now places a visible,
confirmed live presentation before finite-area ties within the playing tier.
The new artifact applies 40 to the live stream and unmutes it, leaves the ad's
properties unchanged, and retains the live baseline/badge when the ad later
becomes muted/zero. No site-name or element-ID adapter was added.

Review exposed two additional event gaps, each proved red before repair:
`play` bypassed the explicit-selection/pause/PiP/fullscreen admission guard, and
MSE data arriving after metadata did not trigger admission. Both now use the
existing owner; 38 registry tests pass. Exact fullscreen video remains protected,
while a container holding both ad and broadcast admits the latter within its scope.
Inactive presentation metadata is rejected before the announcement cache so it
cannot overwrite the Background media/audio owner or suppress a future selection.
The three metadata/data/duration message regressions were red before this guard;
registry and native-executor suites together pass 102 cases.
Fresh read `live/liveTarget` also now travels
through the physical commit, retaining the exact-target publication fence; the
113-test coordinator suite includes both true and false first-output read proofs.

Final built-artifact Huya verification excluded audible finite clips and required
the canonical snapshot to identify the live target. Actual product output RMS:
baseline 0.0120151; requested zero 0; requested 70 0.00590489; mute 0; unmute
0.00885429; shortcut 0.0150326 (13 assertions). Programme variation prevents these
samples from proving an exact gain ratio. All 135 isolated unit files and the
canonical SPECTRA typecheck pass. The new dist still needs user-session readback;
the personal Edge profile has not been accessed.

Final recheck after the inactive-metadata guard: 45 built-browser cases pass,
including the public Huya oracle; one existing discard/restore case is skipped
because of the tested Chrome capability. Latest Huya RMS is 0 at requested zero
and mute, with nonzero output after 70/unmute/shortcut. Strict Biome, four-document
lint, and production dist integrity pass. `verify:q` still fails only
`PUBLIC-PARITY-003` (32 content differences against baseline 22); this is not a
full release-gate PASS. Evidence and auxiliary-probe disposition are indexed in
the local `artifacts/stale-source-20261107/README.md`. Compared against the preserved
222-file repair checkpoint, 207 files are unchanged and 15 are scoped changes:
four production files, six tests and five documents. Unrelated files and HEAD are
hash/ref identical. No commit, push or public projection was performed.
Final public Douyin regression also passes on the same dist (14 assertions):
native volume 30/70 produces nonzero output, zero produces RMS 0, and hotkey,
slider recovery and an injected optional-read failure preserve real control.

Related scoped follow-up: Background Content RPC has a 5-second deadline while a
Capture START can take up to its existing 15-second budget. This is a separately
identified budget-consistency risk, not the cause proved by the public timing
samples. Repair it through the existing deadline owner if its slow-start vector is
admitted; do not add another retry loop or lengthen every passive read.

The user reports that the current live player cannot be controlled or synchronized,
with `stale-media-source: The media source changed before the asynchronous native
operation committed`, and confirms loading `dist`. Personal Edge remains outside
the authorized test surface. The source guard and native writer already exist in
local `main`; they were not deleted or newly invented by this repair.

One independently reproduced gap is now fixed in `control-coordinator.ts`:
`prepareIntent` flattened the native lifecycle error into an untyped Error, and
effective volume then compensated the retired target instead of continuing the
gesture on the replacement. Preserve the error code; before any processor stage,
an implicit native-volume request with neutral Boost may continue once on a fresh,
different target in the same document/generation. Re-read all three audio values,
retain the first absolute requested volume, and keep the existing native writer,
physical ACK, navigation fences and Capture admission. Explicit targets and a
second stale result fail without writing the old baseline into a retired player.

Verification sequence and remaining boundary:

- Added a coordinator regression first; the existing source failed it with
  `stale-media-source: Media source was retired`.
- Added a built-browser fixture that replaces the actual video during the page
  controller's volume write. Its initial unarmed version could swap during runtime
  warmup; the retained test arms only after acquisition and asserts replacement.
- The retained test fails against the old dist. Rebuilt dist returns an ACK for
  the replacement media, whose physical volume is 0.4, and publishes badge `40`.
  Both existing same-document runtime replacement cases also pass (3 browser tests).
- Focused coordinator suite: 111 tests pass, including fixed delta, equal-value replacement, explicit target,
  unchanged target, repeated replacement, document/navigation and missing-read cases.
- Earlier cold public Douyin and Huya controls passed in isolated Chrome, but did
  not reproduce the user's exact generic error text. The fixture produces the same
  stale-source code with the more specific retirement message. These are distinct
  facts; the user's existing live session is not certified by the fixture.

Keep the repair confined to native-volume continuation. Do not add an unbounded
retry, replace the media algorithm, roll back unrelated branch work, or infer that
the user's running page loaded a new artifact merely because dist was rebuilt.
Final gates and retained log paths are recorded with the completed verification.

### Corrected scope: only the live-volume regression

The user's latest clarification is explicit: retain the branch's other features
and fixes, and revert only the change breaking live volume. A mistakenly broad
main restoration was immediately undone using a byte-verified recovery snapshot:
all 222 original task files and the original artifact were restored. The Git refs
and unrelated work were unchanged. Main build/test results from that aborted
operation are not evidence for the active branch. Recovery material remains under
repository-root `artifacts/rollback-main-20261107/`.

A narrow, reproduced regression is the mandatory extra volume read introduced
after main: warm controls with a valid current target never reached their existing
writer if that extra read threw or returned an error. Both new counterexamples
failed before the targeted change. The coordinator now preserves a successful
refresh, but permits the original writer to proceed from a complete same-target
baseline when that refresh fails. Cold and other-target controls still fail.
Failed reads cannot produce cached same-value success: native, amplified
page-native and split-Boost paths must obtain a real target writer ACK. Seven
focused regression cases pass, including missing-target amplification rejection.

This changes one production file, the volume operation in the existing
coordinator. No document-output capability, speed, PiP, preset, media lifecycle,
Remote or Badge repair was removed. A public native-signal test additionally
faults only the extra read while driving the real slider and sampling audio;
its result must be recorded separately from the user's still-unreproduced failure.

Final bounded evidence for this targeted correction:

- All 135 isolated unit files pass; all four canonical typecheck packages pass;
  production rebuild and strict checks of the changed source/tests/docs pass.
- Affected Popup/hotkey/page-media/document-output browser suites: 39 pass,
  two skips, zero failures, 348 assertions. Skips are the opt-in public output
  case (run separately below) and the existing Chrome 157 discard-state case.
- Public Douyin native signal: 14 assertions pass. With the extra read deliberately
  failing, actual slider zero gives RMS0, recovery gives RMS0.0049310, and the zero
  badge agrees. This faults the observation transport only, never the writer or
  signal oracle.
- Public Huya video-only MediaStream: the existing product-output oracle passes
  12 assertions using real UI. RMS baseline0.0229864, volume-zero0,
  volume70=0.0167311, muted0, unmuted0.0407493, shortcut0.0457778.
- A preceding Huya native-oracle attempt failed on that separated source. Its
  observer had occupied tabCapture, so it cannot certify this source's product
  Capture route. The native test now rejects that source before acquiring its
  observer; the correct product-output test result is reported separately.
- Snapshot hash comparison verifies 217 of 222 original task files are unchanged.
  The five changed files are one production owner, two tests and two documents.
  Unrelated files and Git refs are unchanged. No personal Edge state was read.

The user reports control still fails. Earlier isolated passes do not settle this
incident. No personal Edge access is authorized. Current source comparison uses
local main `aecc6304` and HEAD `a6d2e021`; neither identifies the previously
installed binary by itself.

The effective-volume formula is unchanged: base times boost. Main already used
exact page-controller / DOM native volume and MediaElement WebAudio or tabCapture
for processing. The committed branch mainly changed speed/controller agreement,
selection, observation ordering and lifecycle. Its purpose does not justify losing
working live volume.

Subsequent working-tree repairs added a materially different route: a proven
video-only MediaStream can request document-output Capture even below 100 percent.
This helps only that source shape and still needs existing Capture admission;
manual direct routing rejects it. No registered media target and other separated
audio shapes are not covered by that predicate. Every effective-volume request
also now requires fresh Content readback instead of main's cold-only read with
snapshot fallback; a failed read terminates control. These are concrete changed
failure boundaries, not proof of the user's current sole cause.

The initial diagnostic requirement was a matched main/current failing-path comparison that
identifies the target, actual audio owner, invocation/admission and physical effect.
Do not add another general routing mechanism or claim user-visible repair from
unrelated blob playback, property ACKs or aggregate test counts.

## 2026-11-06 renewed failure and disposition

### Whole-branch business repair checklist

The user subsequently authorized fixing the remaining business regressions in
this branch. Integration remains in this workspace, with isolated browsers only.

- [x] Retire speculative cross-runtime Badge/Popup writes: wrong fixed hotkey
  target, retired document/subframe, failed request and leaked presentation caches.
- [x] Repair Remote equal-control-revision observation loss and independent audio
  lifecycle clocks; retain per-field ordering and bounded pending publication.
- [x] Reproduce and close whole-smoke live-volume restoration race; preserve
  both physical page volume and UI/Badge instead of only extending timeouts.
- [x] Close neutral visualizer / unsafe stream regression without granting
  Capture to an observation-only request.
- [x] Consolidate bounded live evidence for normal audio-bearing sources and separate
  document output, including normal UI, actual signal, reset and release.
- [x] Run the integrated unit/browser/type/build/docs gates and report all skips
  and public-projection limits explicitly. Do not widen release baselines.

Initial whole-smoke run: 77 pass, 4 skip, 2 fail (live UI synchronization and
neutral unsafe-stream visualizer). Huya 791185 currently exposes audio/video in
a blob source, not the earlier video-only MediaStream: native live signal run
passes with RMS 30=0.0035094, 70=0.0087134, zero=0, shortcut=0.0013440,
slider-zero=0, slider-up=0.0013968. Nonstationary live samples are not a gain-ratio
measurement. A bounded test pass does not close every reported Huya surface.

Additional confirmed repairs in the integrated tree:

- Remote: equal control revision no longer drops new volume/playback/speed
  observations. Pending and final publication merge field observation stamps;
  lifecycle generation/configRevision/phase belongs to the independent audio
  clock. Eighteen focused Remote tests pass, including delayed older samples.
- Badge: deleted the hotkey stage/broadcast files, their registration, Content
  time-based dedupe, global Popup DOM listener and unused Port tone payload.
  Failed/retired/wrong-target requests cannot prepaint successful use. Existing
  actual projection remains; bounded paint/order caches retire before async tab
  cleanup. Current audio lifecycle comes from the canonical session store and
  never overwrites the control generation.
- Media selection: scrolling a same-source player out of and back into the
  viewport no longer creates a new visit and replays old volume40 over page80.
  Layout-box disappearance is distinct from viewport clipping. Genuine hidden
  and SPA target returns retain their restoration behavior; a production-browser
  scrolling test verifies source/selection, volume and badge remain unchanged.
- Test causality: the two live Popup cases use distinct requested values so a
  restored old 40 cannot impersonate the new slider write. The unsafe native
  visualizer fixture now carries an actual audio track; video-only output remains
  a separate acceptance case. The preceding test restores portable volume through
  the real slider, rather than only resetting internal runtime configuration.

Validation layers are deliberately separate. The integrated full smoke run
passed 79 cases, skipped four, and failed none (669 assertions). After the final
scroll and Badge-clock fixes, the affected Badge/Capture/document-output/page-media
browser set passed 27 cases with one opt-in public-site skip (226 assertions),
including the new scroll case and real slider-to-output RMS. Final canonical unit
run passes all 135 files; canonical typecheck passes all four packages; production
build passes. The final source changes did not change unrelated smoke consumers.

Live Douyin rerun passes both cold slider/actual/badge and native audio signal
cases (19 assertions): 30/70 have nonzero output; zero and slider Home return 0;
shortcut and slider recovery return nonzero output. Huya cold slider/actual/badge
also passes. One subsequent Huya audio run did not establish playback within the
60-second precondition, before any control assertion; the earlier same-turn
native audio run passed. Retain both outcomes rather than converting an external
playback timeout into a software PASS. A final production-build Huya native rerun
then passed all 10 assertions: RMS 30=0.0034391, 70=0.0087738, zero=0,
shortcut=0.0014149, slider-zero=0, slider-up=0.0014950. Public video-only Huya
shape and the user's personal session remain outside the reproduced evidence.

The four full-smoke skips are three opt-in public live cases (separately exercised
where the playback shape is available) and the existing Chrome 157 discard/restore
case whose browser no longer produces the tested discarded-tab state. Public parity
is still a release blocker: 32 drifted files against baseline22; the two missing
stage files are gone because their unused production chain was removed. No public
repository writes or baseline widening occurred.

Reusable validation rule: identify source tracks and actual output owner before
choosing the signal oracle; use normal UI for admission and continuous transport;
correlate a physical write with this input, not a coincident restore value. Keep
observation clocks separate from control and audio lifecycle clocks. Validate a
final small source change through its affected consumers instead of rerunning all
unrelated live pages. No diagnostic checkout, new dependency or browser profile
is intentionally retained; maintained regression tests, owner docs and dist remain.

### Earlier same-day diagnosis and disposition (superseded where stated above)

The user confirms Douyin volume now works but UI does not synchronize with the
Action badge, and Huya remains uncontrollable. This report reopens acceptance;
the earlier isolated runs below do not override the reported failure. Personal
Edge remains excluded. No whole-branch rollback has been performed.

Two badge counterexamples were reproduced before editing and their tests failed:
`actual60 → stage40 → actual80` leaves badge40 permanently, and `saved80 → page55
→ reproject` returns badge80. The 600ms stage override exists in main too, so a
whole-branch reset is not a repair for that defect. Removed the elapsed-time
override, retaining immediate stage feedback and the newer-in-flight-input fence.
The canonical badge composer now reads the latest accepted snapshot after async
reads and uses durable settings only for missing fields. Both regressions pass;
the related three-file unit run has 119 passing tests. Real Action Popup fixture
tests now also require badge80 after page80, with both initial mute states passing.

Huya evidence correction: the earlier output-signal test opened the real toolbar
Popup but submitted the volume operation by RPC. It did not prove the actual
slider/continuous transport, nor badge agreement, and selected only video-only
MediaStream playback. The new cold-slider test requires committed actuals at the
initial above-100 request, zero and restored volume, plus matching Action text;
one isolated Huya room passes that UI/state check. This is not a sound oracle.
The public output-signal test now drives the real slider with keyboard input and
checks badge agreement before sampling the product graph. Other Huya playback
shapes and the user's failing surface remain unresolved until directly reproduced.
The 2026-11-06 rerun of room 791185 timed out waiting for video-only MediaStream
playback before any control or output assertion; no audible PASS is claimed for
that run. This is a coverage/precondition failure, not proof that the user loaded
the wrong artifact. The earlier single-shape signal PASS is not general Huya
compatibility evidence.

Disposition is by behavior and its dependent implementation/tests, not by dirty
file or mixed commit. The 26 branch commits and later edits contain these groups:

| Decision | Work |
| --- | --- |
| Keep | Popup sender identity, global preset fallback, explicit same-origin setting carryover |
| Keep | Physical speed/menu agreement, free speeds, SPA source retirement/restoration, truthful playback and PiP, first-frame/card lifetime fixes |
| Keep | Epoch-scoped media IDs, fresh actual reads, per-field observation stamps, explicit failure feedback and preserved shortcut invocation |
| Remove / keep removed | Universal volume adapter, global audio graph interception, synthetic slider/CSS success, silent 100/neutral-Boost clamps |
| Remove now | Badge elapsed-time prediction override and durable-preference precedence over current actual |
| Hold as one candidate | Document-output Capture, its contracts, output graph, hydration and release lifecycle; do not split off a flag while leaving the dependent path active; do not label this universal Huya support |
| Hold outside live repair | Custom scrollbar, broad controller-discovery heuristics and further performance restructuring without separate business evidence |
| Preserve evidence, reject certification | Existing public-parity baseline expansion, historical diagnostic samples and bounded tests; none can certify live compatibility |

Follow-up tasks remain scoped to this incident: reproduce Huya using normal
controls and a nonzero final-output oracle across actual playback shapes; compare
the failing shape with main before removing the complete output candidate; fence
hotkey preview messages by current top document (the current listener only checks
extension and tab identity). Keep valid observation/lifecycle regressions during
that reduction. No new global hooks, hostname fallback or second state owner.
Current bounded repair validation: production build, 4-package canonical typecheck,
7-file strict Biome and 2-document strict lint pass. No branch reset, commit,
public sync or personal-browser operation was performed. Existing unrelated dirty
work and evidence remain; only maintained tests/docs were added to this follow-up.

## Current follow-up: source identity and document-output volume

This section records the current working repair; earlier results below belong to
their named earlier tree. The local repair has physical browser evidence, but the
branch is not release-certified: public-parity still reports two missing files and
29 drifted files against its 22-file baseline. The baseline was not widened.

The follow-up found two gaps in the prior repair. Media IDs used a counter that
could restart when Content recreated its registry, while the Background snapshot
retained the old target. Effective-volume planning could also accept a same-value
request from that snapshot without reading the replacement target. Registry IDs
now include their observation epoch, and every effective-volume request reads the
current implicit target's volume/mute pair before choosing or skipping a setter.

A video-only `MediaStream` exposes a different boundary: changing that video's
volume cannot scale audio carried outside it. The new `nativeAudioAbsent` fact is
bound to the exact target/source and requires real video tracks with zero audio
tracks. It is not inferred from a host, live duration, canvas or a missing element.
An implicit full-output request can then use the existing one-shot admitted
Capture/offscreen owner; an exact-target request cannot widen its scope, and a
manual `direct` route rejects the demand without modifying the page's graph.
An exact working page-native controller still takes precedence over this fallback;
an audio-less video alone must not displace an acknowledged page audio owner.

Reuse remains the existing Chrome Capture API, processor contracts and sparse
AudioGraphRouter. No hostname adapter, global hook, synthetic site gesture, second
audio engine or new dependency is introduced. `AudioConfig.documentOutput` is
runtime-only and is rejected as a persisted preference. The logical base/boost
pair maps to processor `outputLevel.gain` (`0..8`) plus independent mute, with
physical `boostGain=1`, preventing double multiplication. Capture success must
include running context, graph signature and actual AudioParam readback after the
ramp/render-clock boundary. A matching configuration object is insufficient.

Zero and 100 remain owned output levels. Reset and restore-page-settings now send
internal `releaseDocumentOutput: true` to withdraw this demand; disable and
navigation use the existing lifecycle. Capture may stop only after all independent
demand ends and the real stop ACK succeeds. This release path is part of the
acceptance suite and has passed both reset and restore-page-settings browser cases.

A separate observed race affected Popup feedback: volume 40 was confirmed before
an asynchronous unmute, the site then changed to 80, and the old volume was stamped
with the later transaction observation. Native writes now retain each field's own
confirmation stamp. Popup settlement uses the existing observation reconciler even
at equal control revision, releases pending input and preserves the newer page value.

Progress and evidence at this documentation update:

- [x] Implement epoch-scoped media IDs, fresh current-target native-pair reads,
  and the strict absent-native-audio fact.
- [x] Route admitted implicit full-output control through the existing Capture
  owner and expose independent level/mute processor configuration/readback.
- [x] Fixture output at 70/30/0/100/200, mute/unmute and shortcut control: measured
  RMS approximately 0.02474/0.01060/0/0.03529/0.07048; the silent video's native
  volume/mute remain unchanged. Both reset and restore release the real processor
  and restore nonzero original-tab audio. Document-output and runtime-restart
  smoke: 5 passing tests, 71 assertions, including the public Huya run.
- [x] Real Huya `https://www.huya.com/791185`: actual Action Popup invokes Capture;
  output is measured at the product processor analyser, not upstream tab audio.
  After advancing beyond 25 seconds, baseline RMS 0.001138736; zero and mute both
  produce 0; restored 70 produces 0.0053125 and unmute 0.0239615. Alt-Up advances
  70 to 80 with nonzero output. Live speech is nonstationary; these numbers do not
  establish a fixed live amplitude ratio.
- [x] Real Douyin `https://live.douyin.com/339638082961`: native audio-bearing
  MediaStream; baseline nonzero, RMS at 30 approximately 0.01463506, at 70
  0.03426094, at 0 exactly 0. Shortcut and Popup slider restore nonzero signal;
  Home returns zero. Cold Popup 190 is separately verified as control/UI evidence.
  Live-volume smoke: 2 passing tests, 14 assertions. Both site runs use isolated
  Chrome 157.0.8103.39 profiles, never the user's Edge/profile.
- [x] Final five-file browser regression: 51 pass, 1 existing skip, 0 fail,
  343 assertions. Includes hotkeys, page-native ownership, SPA speed/lifecycle,
  Popup/PiP, both page-volume/ACK order cases, browser-allowed unmute and explicit
  browser-policy rejection. Native fixtures have real audio tracks; transport is
  acquired before passive autoplay sampling to avoid a test-created focus pause.
- [x] Final canonical unit run: all 135 isolated files pass, including the corrected
  coordinator fixture (96 cases). Canonical SPECTRA typecheck: all 4 packages pass.
  Production build and dist integrity pass (13 entrypoints and manifest resources).
  Final changed-file Biome check has zero diagnostics; all 12 checked control/audit
  documents pass strict documentation validation; `git diff --check` passes.
- [ ] Public projection reconciliation remains outside this local repair's write
  destination. Architecture: SPECTRA control 0 errors; public-parity is the only
  failing check (2 errors). No release, public sync or real Edge installation is
  claimed. Whole-branch release remains blocked.

Cleanup: the task-created main comparison checkout/cache was removed after its
two dependency junctions were detached and their real dependency targets verified
intact. Existing unrelated dirty files and historical evidence remain untouched.
The failed sandbox-launch profile `spectra-smoke-rHkPdu` was also removed after
absolute-path and reparse-point checks; existence readback is false. No task-created
comparison checkout or failed browser profile is deliberately retained. Regression
fixtures/tests and this evidence record are maintained source, not disposable probes.

Canonical rules are in the existing
[strategy owner](../../apps/extension-spectra/docs/control/02-strategy-and-routes.md),
[algorithm matrix](../../apps/extension-spectra/docs/control/04a-algorithm-matrix.md)
and [state owner](../../apps/extension-spectra/docs/control/05-control-state.md).
The earlier summary of element-free limitations remains historical: this repair
admits only the specifically proved video-only-stream case and does not claim
support for every element-free audio document.

## Scope and baseline

The user reports that Douyin and Huya live volume no longer works. This record
captures the initial source audit and the subsequently authorized local repair.
The repaired production build and bounded browser regressions passed; audible
playback in the user's existing Edge session remains unverified. Git history and
the user's browser profile were not changed. Independent dirty fixes are retained.

At inspection, branch `docs/spectra-douyin-speed-sync` and its local remote-tracking
ref point to `a6d2e021`; local `main` points to `aecc6304`. No fetch was performed.
`main...HEAD` contains 26 commits, 165 changed files, 16,064 added and 1,578 deleted
lines. The pre-audit working tree adds changes in 79 tracked files (4,739 added,
1,620 deleted lines) and 91 untracked files, including 55 evidence JSON files and
two unrelated `.workbuddy-ai` files. These sets overlap: `git diff main` reports
197 tracked files, 20,712 added and 3,107 deleted lines, excluding untracked files.

The uncommitted tracked changes include 34 runtime-source files, 23 test files and
22 other files. Seven already-staged deletions remove performance/visual test
files and their runners. Counts describe scope, not the cause of this regression.

## Findings and evidence limits

The following findings describe the experimental working tree **before repair**.
The universal volume adapter, graph interception and slider painting described
below have now been removed; source links point to the repaired owners.

1. **Capability discovery does not prove audible ownership.** In
   [`page-media-bridge.ts`](../../apps/extension-spectra/src/content/injector/page-media-bridge.ts),
   `effectiveAdapter` returns the universal volume adapter without inspecting the
   element. `discoverCapability` selects a discovered controller before considering
   `outputGainCapability`, which is consulted only when no controller wins. A
   controller that changes and reads back only `video.volume` can therefore keep
   the request away from the actual WebAudio output. This is a concrete failure
   path; whether it is the user's current Douyin failure requires live attribution.

2. **The output path remains dependent on a media element.** The same bridge's
   `onPageMediaRequest` rejects targets other than `HTMLMediaElement`.
   [`NativeMediaExecutor`](../../apps/extension-spectra/src/content/logic/native-media-executor.ts)
   rejects native field writes without a selected media target. The existing
   [Huya after-ad sample](evidence/2026-11-05-audio-truth-huya-after-ad.json)
   records no top-document media elements after 70 seconds. In that state the
   element-addressed control path cannot reach a document WebAudio output even
   if an output gain exists. The sample's zero RMS values do not prove playback
   or audible success; cross-origin frames were not inspected.

3. **Presentation can change without a proven audio change.**
   `paintNativeVolumeControl` dispatches synthetic pointer events and then writes
   slider styles even if the site ignores those events. Its caller's comment
   says it never dispatches pointer gestures, contradicting the implementation.
   A moved bar is therefore not independent confirmation of a successful write.

4. **The verified claim exceeds its evidence.** The registry labels the universal
   volume row `verified`, but the cited
   [user-confirmation record](evidence/2026-11-04-live-volume-base-user-confirmed.json)
   records “dy可以控制了，虎牙还是不行”. Its confirmed scope is one
   `www.douyin.com` live-volume session; Huya audible behavior and the standalone
   `live.douyin.com` origin are explicitly unconfirmed. Do not promote controller
   readback, changed CSS, zero-signal probes or a historical confirmation into
   present two-site compatibility.

5. **Audio graph interception is asymmetric.** `installOutputGainEdge` rewrites
   `node.connect(context.destination)` to connect to an inserted gain, without
   corresponding handling for `node.disconnect(context.destination)`. The latter
   no longer names the actual connection. This is a source-level lifecycle defect;
   no current Douyin/Huya stack trace establishes it as this incident's trigger.

The locally built manifest names `content-page-media-bridge.js` at document start.
The user's currently loaded extension artifact and document injection generation
were not established. No first-bad commit or sole cause is claimed.

## Root-cause follow-up and acceptance

### Authorized repair plan

The user subsequently authorized function repair and cleanup while preserving
useful branch fixes. Comparison with `main` establishes that element-free volume
is also a mainline limitation, not a newly removed capability. The confirmed dirty
regression is the shortcut path: the handler discards validated `site-page`
invocation identity, admission rejects that origin, and two content layers clamp
amplification to 100/neutral Boost. Restore the existing authorized path and let
the browser decide actual capture permission; never manufacture a successful
neutral request from a failed amplification intent.

Reuse decision: retain the existing native media writer, exact page-controller
bridge, MediaElement WebAudio owner and Chrome tabCapture/offscreen graph. A new
library cannot supply browser permission or prove a private player's audio owner.
Remove the experimental global graph interception and synthetic slider driving
instead of repairing a second audio engine. No dependency or lockfile change is
needed. Preserve the branch's committed speed/lifecycle fixes and the independent
PiP, first-click target, media-admission, session-silence and badge regressions.

- [x] Remove the uncommitted universal volume adapter and global output/slider
  interception, retaining the committed exact-element and Douyin speed bridge.
- [x] Restore validated page shortcut invocation and remove both volume clamps.
- [x] Restore the seven deleted performance/visual owners and their package
  commands; remove the unproduced performance metric declaration.
- [x] Add handler-level admission and browser non-interference regressions;
  run focused tests, production build and applicable checks.
- [x] Consolidate useful probe evidence; remove orphan experimental probes and
  repeated failed measurements after preserving their distinct counterexamples.

- [x] Measure committed and dirty scope separately; preserve existing changes.
- [x] Audit volume owner selection and distinguish evidence from compatibility claims.
- [x] Keep browser permission as the authority for Capture. Retain exact sender,
  tab, document and one-shot admission checks; reject child-frame invocations.
- [x] Preserve requested amplification when unavailable and report the real
  unsupported result instead of clamping it into a successful neutral request.
- [x] Remove the second graph owner altogether. A production-browser regression
  checks native `connect(destination)` / `disconnect(destination)` behavior;
  `SCTRL-053` forbids global audio graph interception and synthetic slider gestures.
- [ ] Identify the user's loaded artifact and verify exact audible live playback,
  separating advertisements, programme playback, main-site overlays and standalone
  rooms. Native Edge access timed out before app approval; no extension reload or
  user-page interaction occurred. Local harness results do not close this item.

Element-free audio remains an explicit compatibility boundary inherited from
mainline, not a new feature claimed by this repair. Do not resurrect a global graph
interceptor or fabricate a media target to conceal that boundary. A future failing
live reproduction must first establish its actual audio owner and permission state.

## Validation and artifact

The pinned Bun 1.4.4 toolchain produced the local `apps/extension-spectra/dist`
artifact. No release, public mirror synchronization, commit or push was performed.

| Evidence | Result and boundary |
| --- | --- |
| Canonical unit runner | 133 of 134 files passed in the sandbox; the remaining release-tooling file hit loopback `EACCES`, then passed outside the sandbox: 39 tests, 182 assertions. All 134 files have passing evidence, not one uninterrupted all-green run. |
| Production Chrome media/hotkey/Popup/speed suites | 50 passed, 1 pre-existing skip across the final suite results. A speed fixture sampled before DOM ready; corrected to the first frame after DOM ready, then all 14 speed tests passed. No retry waits for the expected label. |
| Production Chrome Capture suite | 7 passed, including amplification, fullscreen and worker recovery. Uses the harness tabCapture stub and a synthetic MediaStream; does not establish real live-site audio or browser authorization in the user's profile. |
| Audio signal oracle | 1 passed with Chrome integration enabled: OfflineAudioContext sine signal at gain 1.1, no dropouts or doubling. This is a signal check, not a live-site listening test. |
| Canonical typecheck | 4 of 4 owners passed: contracts, kernel, audio engine and SPECTRA. |
| Strict application lint | 475 files, zero diagnostics and zero silent handlers; subsequent fixture/guard changes also passed focused strict lint. |
| Build / dist / integrity | Passed; 13 entrypoints checked, zero duplicate integrity sources. Existing Popup size signal remains nonblocking. |
| Performance / visual policy registration | Passed: 8 and 11 policy tests respectively. Restored runners are registered; full performance and visual baseline suites were not rerun. |
| Architecture verifier | SPECTRA control has zero errors. Whole-repository verification remains blocked by public parity: two missing projected files and drift count 23 against baseline 22. The existing baseline was not widened. |
| Documentation | Related owner, proposal and research documents passed strict checks. Whole-repository check is blocked by unrelated `.workbuddy/memory/2026-11-03.md` having no H1. |

Key production SHA-256 identities (hex):

| File in `dist` | SHA-256 |
| --- | --- |
| `manifest.json` | `D8ADF4010FEA8C73AAEDE0B1356809D83E0F57AD0E71344C91F5F4D3779F475B` |
| `background.js` | `49C019F97B7FE4B0ED599063B1E916F9C6879AE2F6560DA92D014B039BFFE924` |
| `content-page-media-bridge.js` | `EC60D0E31B443BD8E0F92C82CE51DB9518E252E62AA52E0DFD74839B371DF0E3` |
| `content-runtime.js` | `05C1EDA91314B52F604BC2E36E6D730B225F520652E8C1C2FD683AA0EB3AB9DE` |

Reload the extension from this artifact and refresh existing live pages before
checking playback: rebuilding files cannot remove an old MAIN-world interception
already installed in an existing document. The loaded Edge artifact is unverified.

## Branch problem inventory and preservation obligations

### Active repair after the latest failure report

Two independent failing mechanisms are now reproduced with isolated Chrome and
the production extension. Personal Edge remains excluded.

- Runtime retirement/recreation reused `media:1` IDs while Background retained
  old target actuals. A hidden replacement received the write, or a missing old
  ID left repeated real Alt+Up gestures ineffective. Epoch-scoped IDs and one
  current-target native-pair read before planning fix both production regressions.
  Full-document processor ACKs must survive selected-media retirement.
- Huya `791185` supplied a video-only MediaStream. Native 0% returned a successful
  `dom-native` ACK while real tab audio RMS remained `0.027367`; the video has
  native volume descriptors and no discovered exact controller. This is audible
  failure, not another stale-label diagnosis. Initial tests that manually muted
  the page were replaced with a nonzero natural-audio baseline.

Implementation plan (current task, not release certification):

- [x] Preserve both runtime replacement counterexamples in the canonical smoke
  suite; make them pass without touching hidden replacement media.
- [x] Preserve document processor state across media-owner changes; regress a
  surviving Capture gain and same-value explicit unmute against fresh actuals.
- [ ] Add target-bound native-audio absence evidence from the standard
  MediaStream track API; do not infer it from hostnames, Infinity or silence.
- [ ] Reuse the existing admitted Capture/AudioGraphRouter for explicit document
  output level and mute. Keep logical Boost at 1–8 and express the distinct
  physical output level as typed processor configuration. Existing media writers
  must not simultaneously control the same audio level.
- [ ] Make snapshots, all control surfaces, reset/release, route lifetime and
  failure admission follow that output owner. Neutral 100% and mute/zero do not
  silently release document output ownership.
- [ ] Verify the final processor output, native-media regressions and real live
  controls; reconcile contracts, owners, build and required gates.

Reuse decision: standard element volume cannot affect audio outside the element;
Tabs exposes mute but no continuous-volume API. Existing tabCapture and the
existing offscreen graph already own full-tab audio and permission/lifecycle
handling; no new library or audio engine is needed. Native source discovery and
explicit admitted Capture are preferred over a site-specific controller adapter
or global graph interception. See the
[browser tabCapture contract](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
and [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs).
Once product Capture runs, measuring the original tab measures input, not the
extension's final output; the signal oracle must sample the latter. The current
working repair is not yet a compatibility PASS.

This inventory answers the renewed request for the whole branch, including its
uncommitted follow-ups. It records intended outcomes, not a certificate that every
outcome currently works. Commit messages describe historical intent; the current
contracts, implementations and production behavior decide acceptance. The live
incident remains open after the user's renewed failure report. No personal Edge
profile may be used for further investigation.

| ID | Problem the branch attempts to solve | Provenance / retained acceptance target |
| --- | --- | --- |
| P01 | Douyin changes physical speed without updating its own speed menu | `223e14da`, `0b5fe18e`, `49c91cc8`: physical rate and available site menu projection agree; a controller-only ACK is insufficient |
| P02 | Opening/switching videos resets speed or cancels the old-source write | `5bf3d1bf`, `943be6d2`, `3318525c`: correct source identity, cancellation and owned-intent replay |
| P03 | Free speeds bounce, report settle errors or use a misleading site-menu value | `7292c23a` through `9ec8cab1`: physical success, safe page/DOM handoff, truthful unsupported result; earlier controller-only success was superseded |
| P04 | Default speed text is unreadable and site renames break discovery | `a37acf01`, `4e9f97cc`: normal-rate labels work; broad rename heuristics need concrete evidence and must not select another player |
| P05 | Action Popup query parameters cause valid controls and observation ports to be rejected | `7cb54e08`: admit the exact extension document identity while rejecting other documents and forged senders |
| P06 | A site without its own preset loses the global preset | `4629c53d`: site preset, then global preset, then defaults; retained explicit intent keeps its defined precedence |
| P07 | Same-origin navigation into another tab loses temporary settings | `4a2aa3f4`: carry portable explicit intent; isolate other origins and resource-only observations |
| P08 | Page changes, Popup and Remote disagree about actual volume/speed/playback | `11d06740` and follow-ups: physical observation commits once, publishes actual values and never echoes another write |
| P09 | Closing live/modal players, SPA changes or revisiting media leaves the wrong target/speed | `943be6d2`, `3318525c`: retire hidden/detached/source-stale targets and restore the correct surviving video intent |
| P10 | Cold Popup play/pause uses stale state; buffering or intercepted events produce false success | `3318525c`, `dd3c18f7`: actual playback baseline, bounded completion, ordered rapid actions and truthful browser rejection |
| P11 | Popup first frame waits for RPC, omits background slots, jumps or scrolls incorrectly | `292c539f`, `dd3c18f7`, `d908f584`: all announced localized slots, same-node binding, bounded geometry and resource cleanup; custom scrollbar implementation is not itself a business requirement |
| P12 | Media cards have inconsistent eligibility/retention; old reports or hydration resurrect retired facts | `d908f584`: natural media membership, report ordering, retirement fences, retention semantics, freeze/discard/navigation/worker recovery |
| P13 | PiP exits immediately, reports false readback failure or first click lacks the video target | Uncommitted PiP follow-up: native session lifetime, exact active video and actual native enter/leave proof |
| P14 | Live streams are offered ineffective speed controls or carry live status to a different target | Uncommitted live capability work: target-bound capability evidence, truthful speed availability, ordinary volume remains independent; duration-based classification still needs boundary evidence |
| P15 | Page autoplay mute/zero is persisted as the user's preference and silences later visits | Uncommitted session follow-up: preserve explicit choices, distinguish page observations, do not replay unchosen boot-time silence |
| P16 | Already-playing admission or live-first ranking selects a hidden/silent stream instead of the visible presentation | Uncommitted registry follow-up: correct initial admission and ad/programme handoff; element property readback alone does not prove audible ownership |
| P17 | Popup/OSD/Badge number, mute and route colour disagree or stale work repaints the badge | Uncommitted projection work: one actual snapshot, ordered badge projection and consistent feedback; staging/broadcast cost needs separate justification |
| P18 | Live volume, above-100 requests and shortcut admission regress during optimization | Current incident and repairs: restore main-equivalent audible control, preserve request/invocation identity and surface failure; no neutral clamp, synthetic slider or global graph interception |
| P19 | Explicit unmute is rejected before browser admission, or partial field failure is reported as success | Current bounded repair: explicit Popup/hotkey/Remote requests reach browser policy; automatic replay remains conservative; failure reaches the caller. This does not close P18 |
| P20 | Broad architecture/performance work is difficult to verify or run on Windows | `86600218`, `b3d815c6`, documentation/tooling commits: canonical compiler evidence, bounded lint arguments, faithful gates and artifacts; no threshold widening to manufacture a PASS |

The optimization proposal additionally names O1 projection truth, O2 evidence
layers, O3 failure classification, O4 declared site capabilities, O5 internal route
attribution, O6 discovery cache invalidation, O7 executor separation, O8 pending
write tokens, O9 executable contracts/docs, O10 expanded regression matrices,
O11 performance budgets and O12 entry governance. These are proposed mechanisms
and engineering objectives, not twelve completed features or authority to expand
the current repair. Each retained mechanism must protect a problem above or an
existing business obligation below and justify its cost.

### Full preservation boundary

The capability inventory remains owned by
[the algorithm matrix](../../apps/extension-spectra/docs/control/04a-algorithm-matrix.md)
and executable contracts (51 capabilities: 28 snapshot fields and 23 momentary
operations). Do not replace it with a second schema here. Shared coordinator,
executor, registry, storage and publication changes expose all of the following
families to regression, even where this branch did not add the feature:

| Business family | Acceptance obligation |
| --- | --- |
| Volume and silence | Audible 0–100 adjustment, zero/recovery, media mute preserving the numeric value, distinct tab mute, above-100 amplification through existing admitted routes, crossing 100 in both directions, reset/release and truthful denied/unavailable results |
| Audio processing | Audio enable/disable, EQ, bass, compressor, mono, pan, delay; exact source coverage, one acknowledged output owner, no double processing or dropout introduced by handoff, proper neutral/final release |
| Speed and transport | Preset/free speed, normal 1x, preserve pitch, play/pause, seek/relative seek, approximate frame step, whole-media loop, A/B and markers; source-scoped metadata and truthful live/seekable boundaries |
| Video operations | First-click PiP/fullscreen, session exit, rotate/mirror/fill/filter/dim, reset and screenshot; active video distinct from audio target, native policy respected and site CSS restored |
| Every existing control surface | Actual Action Popup and slider, default/custom hotkeys and OSD, authenticated Remote, applicable side-panel controls, native page observations and badge; no surface-specific fake success or stale repaint |
| Presets and restoration | Global/site/session priority, explicit same-origin carryover, refresh/new-tab restoration, cross-origin isolation, page baseline release, no replay of accidental page silence or stale resource state |
| Selection and lifetime | Multiple media, preload/hidden players, advertisement-to-programme handoff, SPA overlays and return, new media sources, navigation, tab close/freeze/discard and service-worker restart; cancel all obsolete work |
| Popup and card inventory | Cold first frame, all eligible main/background cards, no invented unknown-media cards, retention without deleting preferences, stable binding, correct height/scroll, retry/unavailable recovery and localization |
| Visualizer and runtime cost | Real signal from the admitted owner, only allowed visible subscription, no Capture triggered by observation, no leaked listeners/timers/contexts/offscreen leases and no default-page audio work |
| Other exposed operations | Tab pin, information display, Popup/Options opening, allowed URL opening and permission-gated user scripts retain existing capability/permission semantics |
| Security and correctness | Exact sender/tab/document/media/source/revision identity, Remote authority, browser activation/permission rules, one field writer, real readback and storage confirmation; no forged UI or bypassing browser policy |
| Delivery integrity | Production build corresponds to tested sources; meaningful tests and performance/visual gates retained; public parity and historical evidence remain honest; no unsupported compatibility claims |

Acceptance must exercise relevant combinations, not pretend every impossible
combination is supported: main and candidate artifacts, Chrome and isolated Edge,
ordinary VOD and live (Douyin/Huya, standalone and in-site surfaces), cold/warm
documents, mute/autoplay states, multiple media/ad transitions, Popup/hotkey/Remote,
and native/above-100 processing transitions. Unsupported capabilities must preserve
their explicit failure semantics without disabling other fields. The user's main
success report is the regression baseline to investigate, not evidence that every
site/browser combination has already been re-run.

Existing bounded unit/browser evidence protects individual rows, but does not
close this matrix. Main-versus-candidate live A/B, Huya current programme output,
above-100 live output and alternate live surfaces remain open. Adjacent owner text
also still overstates the pre-activation unmute restriction in `05-control-state`
and the algorithm matrix; reconcile those owners with the explicit-unmute rule
before claiming documentation closure. This inventory changes no runtime behavior
and grants no additional external-write or personal-browser authorization.

## Cleanup and retained material

### Branch disposition after the renewed failure report

The user still reports complete failure after the explicit-unmute repair. That
repair and its isolated tests do not establish this incident's root cause or
closure. The user explicitly excludes their real Edge profile from further work.
Further reproduction must use isolated browsers; compare main and this branch
on the same live surface and operation before attributing another causal fix.

Current inventory: local main to HEAD is 26 commits, 165 files, +16,064/-1,578;
the working tree additionally has 65 tracked modifications (+3,493/-391) and
21 untracked files, with no staged changes or deletions. These overlap and must
not be summed as a unique file count. The untracked set is 5 runtime sources,
6 tests, 2 documents, 6 historical evidence files, and 2 unrelated Workbuddy files.

| Disposition | Work | Reason / boundary |
| --- | --- | --- |
| Retain functional behavior | Popup sender identity; global preset fallback; explicitly requested same-origin cross-tab settings | Independent fixes, not live-volume experiments; preserve corresponding contracts and regressions |
| Retain functional behavior | Douyin speed/controller/UI agreement; free speeds; SPA target/source retirement and speed restoration; truthful playback/PiP state | Each addresses a distinct reproduced behavior; retain coherent implementation/test units rather than blindly reverting large mixed commits |
| Retain functional behavior | Cold Popup rendering, inventory lifecycle and first-click video target binding | UI and lifecycle work must not be removed merely because live audio remains broken |
| Retain bounded repairs | Native shortcut/Capture invocation, unclamped amplification intent, automatic silence preference separation, explicit-unmute browser admission and field-error feedback | Distinct regression vectors exist; none alone certifies the current live incident resolved |
| Retain supporting infrastructure | Compiler-owned verification, Windows lint argument batching, canonical browser harness and meaningful regression cases | Protect source ownership and reproducibility; they are not audible compatibility certificates |
| Remove / keep removed | Universal live-volume row, global audio-graph interception, synthetic site slider painting, 100%/neutral-Boost clamps and lost invocation identity | Failed or misleading control mechanisms; already removed/repaired in the earlier cleanup |
| Remove / keep removed | Orphan probes, redundant JSON dumps, removal of performance/visual gates | Earlier cleanup removed 24 probe/fixture files and 49 duplicate JSON files; seven deleted gate files were restored |
| Retain behavior, review implementation cost | OSD/Popup/Badge tone synchronization and speculative early feedback | Colour agreement is valid; extra stage/broadcast machinery and broadened detached proof require their own benefit/behavior evidence, not a blanket live-volume justification |
| Hold outside the live repair decision | Custom overlay scrollbar; expanded controller-name/config/selected-marker heuristics | Neither is required to restore main's live-volume behavior. Preserve pending explicit product intent or concrete site evidence; do not classify working UI as garbage or promote broad guesses from fixture PASS |
| Hold for comparison | New media observation/publication ordering and runtime lease optimizations | Preserve lifecycle fences while comparing main; neither file count nor unit PASS decides whether all optimization machinery is necessary |
| Correct evidence, do not delete blindly | Expanded public-parity baseline and overwritten dated speed evidence | Dirty baseline accepts 22 differences where HEAD accepted zero and names stale mechanisms; the 11-01 evidence file now contains an 11-05 run. These are not proof of release closure or immutable historical evidence |
| Preserve outside delivery | Unrelated Workbuddy files and distinct historical live samples | Ownership and historical meaning are not grounds for calling them runtime garbage |

No runtime files were changed or deleted during this disposition audit. The
decision unit is behavior plus its dependent contract, implementation and test,
not an entire large commit or every untracked file. Current live tests cover
bounded 0–100 standalone Douyin operations under harness autoplay settings;
above-100, Huya, alternate live surfaces and main/branch equivalence remain open.

Removed 24 orphan untracked experimental probe/fixture files and 49 redundant
evidence JSON files after checking tracked references. Restored seven deleted
performance/visual test and runner files plus their existing package commands.
The committed Douyin speed probes and independent functional fixes remain.

Six historical evidence files remain because they preserve distinct observations:

- `2026-11-04-live-volume-base-user-confirmed.json`: bounded user confirmation.
- `2026-11-04-live-volume-control-snapshot.json`: control state snapshot.
- `2026-11-04-huya-volume-shape.json`: Huya controller shape.
- `2026-11-05-audio-truth-huya-after-ad.json`: after-ad no-media counterexample.
- `2026-11-05-live-graph-huya.json`: Huya graph observation.
- `2026-11-05-live-graph-douyin-live.json`: standalone Douyin graph observation.

These are diagnostic history, not current compatibility certificates. The
production `dist`, normal build caches, independent PiP root-cause note and useful
untracked source/tests remain intentionally. Unrelated `.workbuddy` and
`.workbuddy-ai` material was neither removed nor included in the repair.

Avoid repeating the existing diagnostic sprawl: first retain artifact identity,
route, target and nonzero playback evidence in one bounded reproduction. Reuse the
canonical harness instead of creating another site-specific probe for each symptom.
Keep regression checks in the canonical harness and preserve DOM-ready sampling
boundaries. Reuse passing type evidence while production sources and dependency
generation are unchanged; rerun only the affected fixture suite after fixture-only
changes. The renewed incident below adds one opt-in case to the existing smoke
harness; the temporary diagnostic version was deleted.

## Renewed report: real live-output comparison

### Explicit unmute regression follow-up

The next main/branch comparison found an overbroad document-activation guard:
the branch rejected explicit Popup/hotkey/Remote unmute before the browser could
apply its own autoplay policy. A production Chrome regression reproduced the
failure with `Runtime.evaluate(userGesture:false)`: setting effective volume to
30 returned with `volume=0.3`, `muted=true`, `paused=false`, and
`hasBeenActive=false`. This is a demonstrated regression, not proof that every
reported live failure has the same cause.

Repair stays in the existing native executor. Explicit requests reach the same
page/DOM writer; automatic restoration, disposal and rollback keep their default
activation protection. Unmute waits for stable readback and rejects interrupted
playback without forcing play or acquiring Capture. No new dependency, adapter,
audio graph or permission is introduced. Unit vectors cover all three explicit
sources, both writers, successful playback and delayed pause; the pre-existing
automatic restoration rejection remains covered. Popup batches and hotkey
operations now surface field failures through their existing error channels,
without rolling back successfully applied volume.

Follow-up validation on the repaired production build:

- Native executor, coordinator and audio delegate: **150 tests, 684 assertions**
  passed. Both explicit writers and all three user sources are covered, as are
  interrupted playback, automatic restore, and Popup partial-failure feedback.
- Chrome page-media plus isolated unmute suites: **17 tests, 70 assertions**
  passed. The same unactivated-document case failed before this fix and passed
  after it. The hotkey suite separately passed all three cases.
- Real Edge `156.0.4314.58`, `live.douyin.com`: **1 test, 11 assertions** passed.
  The document remained unactivated when muted by the test. RMS was zero while
  muted, `0.088355` after explicit unmute, `0.029633` at 30%, `0.084522` at 70%,
  zero at 0%, `0.012244` after Alt+Up, zero after slider Home, and `0.008526`
  after slider ArrowRight. Live amplitude varies; no calibrated ratio claim.
- Canonical four-package typecheck, strict lint (7 files), production build,
  dist integrity and both affected Markdown checks passed. SPECTRA control
  architecture has zero errors; the existing two public-parity blockers above
  remain unchanged, so this is not a public release certification.
- The configured unpacked `dist` was rebuilt. SHA-256: `content-runtime.js`
  `49CAEBEEA7F8A660DCD495D73A7FA5A55741EF7041D3680E225BAEDFB8380A7D`;
  `background.js`
  `8458091A9846AFCF57E1B849B4A3ECC2199A15D2BDE2FD88DA2A89E80CFC0865`.
  The user's Edge had no open window during this follow-up; its personal profile
  was not launched or reloaded, so loading this generation there is unverified.

Test-process corrections are retained as executable constraints: the unmute test
has its own canonical smoke session because effective volume persists and would
pollute same-origin cold-restoration tests; the live test avoids Puppeteer's
gesture-granting `waitForFunction`, using gesture-free CDP reads instead. Those
two test issues failed before being corrected; the final runs above passed.
The failed sandbox launch's temporary profile was removed with an exact-path
readback, and successful isolated sessions cleaned up normally. Only the two
purposeful smoke regression files and this evidence remain; no new probe dumps,
recordings or dependencies were retained.

### Earlier isolated comparison (before the explicit unmute fix)

The user subsequently reported that Douyin live volume still did not respond,
including ordinary volume control, and authorized choosing any live room. This
remains an open incident in the user's existing browser session. Do not relabel
isolated-profile success as a repaired existing session.

The production artifact identities above were unchanged. Two live rooms were
inspected, including `live.douyin.com/463134668571`, the room named by the existing
Edge window. The standalone player exposes an ancestor `_player` revocable proxy
wrapper, which the generic bridge does not discover. However, its `volume/muted`
accessors simply delegate to the exact video, and the core listens to native
`volumechange`. That discovery gap is therefore **not established as the cause**;
no speculative proxy adapter or audio interception was added.

The extension was loaded through the existing smoke harness into separate temporary
Chrome and Edge profiles. A real browser extension-action invocation admitted
`tabCapture`; an extension-page analyser measured the actual tab output. The
production volume route remained native bypass: this observer is test equipment,
not a product Capture workaround. No audio recordings or user-profile copies were
made. The host-managed inspection tab and temporary browser profiles were closed.

| Operation | Chrome output RMS | Edge output RMS |
| --- | --- | --- |
| Live baseline | 0.085333 | 0.033339 |
| Popup request 30% | 0.038200 | 0.036547 |
| Popup request 70% | 0.080272 | 0.153396 |
| Popup request 0% | 0 | 0 |
| Alt+Up after zero | 0.013555 | 0.010790 |
| Actual Popup slider Home | 0 | 0 |
| Actual Popup slider ArrowRight | 0.011308 | 0.008889 |

Live programme amplitude varies; these samples do not certify a calibrated 30:70
gain ratio. They establish nonzero playback, real silence, and restored sound after
both shortcut and UI operations. Initial zero-only measurements were invalid:
Puppeteer's default headless `--mute-audio` silenced the test output. Removing that
test-only flag and requiring a nonzero baseline fixes the evidence owner, not the
product. A 350 ms drain precedes each one-second RMS window so pre-write buffered
audio cannot be misreported as failed mute. No assertion waits until silence happens.

The retained regression is
[`test/smoke/live-volume.spec.ts`](../../apps/extension-spectra/test/smoke/live-volume.spec.ts).
It uses the canonical browser/profile lifecycle and is skipped unless explicitly
given `SPECTRA_LIVE_TEST_URL`; it has no hardcoded room or site-specific controller.
Run from `apps/extension-spectra` after building the production artifact:

```powershell
$env:SPECTRA_LIVE_TEST_URL = 'https://live.douyin.com/<currently-live-room>'
# Optional: select the installed Edge executable instead of Chrome.
$env:NEXUS_CHROME_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
bun test test/smoke/live-volume.spec.ts --max-concurrency 1 --timeout 150000
```

The formal case requires a nonzero baseline, zero output for both mute-to-zero
paths, and nonzero recovery. Offline, gated or silent streams must not issue a
compatibility PASS. This case tests an activated document under the harness's
autoplay settings, not an unactivated autoplay-policy boundary. It also does not
cover above-100 amplification or Huya. Chromium's action command requires the
`tab` target, not its child `page` target; the test discovers that identity through
the browser's target list ([protocol owner](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/)).

Read-only installed-extension metadata identifies
`apfaijeiioiioccdknfcjjckkohjkpno` at this workspace's `dist`, version 1.4.2, with
site-access withholding false and all-URLs host permissions. Only extension
installation metadata was inspected; it proves the configured path, not the
in-memory worker/content generation. No installed-browser settings were modified.
The remaining boundary is the existing Edge session's actual loaded generation,
per-tab control state and interaction with its other runtime state. Browser UI
access previously stopped because its current URL could not be established by the
host tool. Do not infer from disk metadata that a reload has occurred.

The final opt-in case passed on Chrome 157.0.8103.39: one test, nine assertions.
RMS was baseline 0.081897, 30% 0.043246, 70% 0.092363, zero 0, hotkey recovery
0.011214, slider zero 0 and slider recovery 0.012188. Strict lint and the canonical
four-owner typecheck passed. The compiler initially hit Windows commit-memory
exhaustion (`VirtualAlloc`, errno 1455); the same canonical command passed with
process-local `GOMAXPROCS=2`, without changing system settings or compiler entrypoints.
The no-URL path skipped all hooks and the test, with no browser launch.

During consolidation, foreground-page selection and the invocation Popup's
lifetime caused diagnostic failures. The final test activates the live page before
loading it, then moves to the observer tab to retire the invocation Popup before
opening control Popups. The passing Edge measurements above came from the preceding
diagnostic version; the final consolidated case is not separately Edge-certified.
No production source or build artifact was changed during this renewed diagnosis.

## 2026-11-08: cold restore, presentation and same-page reuse

This follow-up used temporary isolated Chrome profiles only. The user's installed
Edge profile was not accessed. Useful branch changes remain; there was no whole
branch rollback or external publication.

Two real cold-start defects were observed separately from the user's exact generic
`stale-media-source` message. An unchanged same-document history announcement
invalidated an already successful native volume ACK. At an earlier first frame,
a live MediaStream temporarily had video but no audio tracks, causing automatic
restore to attempt a new Capture owner. The repair compares full document/URL
identity before navigation fencing and keeps cold automatic native restoration
native until actual ownership warrants otherwise. Real query/hash/path changes,
document replacement and existing Capture restoration retain their fences.
The exact generic asynchronous-source error was not reproduced in this live run;
these observations do not establish that every occurrence has the same cause.

The presentation regression was also explicit in code and tests: first crossing
kept the old blue tone until Capture ACK, the Popup Port no longer carried the
matching badge presentation, and initial rendering compared independent control
and audio generations. A stale empty ACK could then overwrite a newer physical
volume. The corrected route candidate comes from the existing audio mode policy,
is bound to the current source and observation order, and feeds the single palette.
Pending number/tone are separate from actual, sticky usage and settings; original
Port and shortcut transports own their exact input/document token lifetime.

The scene defect was a target-cache early return that skipped current route/root
identity. A page reusing the same video/source for A and B could overwrite A's
speed with B's value. Rebinding now invalidates only application/maturation proof,
preserves the latest queued restore obligation and restores A's own speed on return.
Identical route notifications still respect a page's newer own value. The five
native reusable fields and scene-specific speed are defined in the existing
[media owner](../../apps/extension-spectra/docs/control/06-media-and-video.md#135-document-replay-intent-lifetime).

Permanent browser tests hold the real writer transport before forwarding it.
Both first Capture hotkey and Popup input must already show purple/110, with a
matching Action badge, before the writer can acknowledge. After forwarding, real
processor and committed control state must remain Capture. The synthetic audio
fixture proves presentation and cross-context behavior, not real-site signal
compatibility. The existing safe WebAudio case must remain blue in every frame.
All five hotkey smoke cases passed after ensuring the new fixture resets its own
speed preference; leaving 1.1 behind had correctly failed the next independent test.

The cold-start repair build passed public Douyin native signal controls and three automatic
refresh restorations: each first live sample was unmuted at volume 0.4 and retained
that value after playback advanced. Advertisement/live selection, source replacement
during a native write, worker replacement, same-page scene return, hidden/detached
live overlays, page-owned changes and explicit template release remain covered by
the existing browser suites. These are sampled scenarios, not all-room guarantees.

After the final late-ACK presentation repair, the rebuilt dist passed seven
hotkey/badge/unmute browser cases and 34 Popup/page-reuse cases, with zero failures.
One pre-existing discard/restore case remains explicitly skipped because Chrome
157 replaces the discarded tab instead of producing the fixture's sleeping-card
state. All 136 isolated unit test files, the four scoped typecheck owners, build,
strict lint and dist integrity passed. Architecture validation still reports
`PUBLIC-PARITY-003` (38 differing files against baseline 22); the public mirror was
not published and the baseline was not relaxed. This is not an all-gates-green
release claim.

The current business owner and mandatory counterexamples are recorded in
[control state](../../apps/extension-spectra/docs/control/05-control-state.md#business-ownership-and-regression-boundary).
Review must preserve those product assertions rather than rewriting them to bless
a regression. Dist is rebuilt from source; diagnostic logs, draft patch artifacts
and recovery checkpoints stay in the ignored task artifact directory for review.
