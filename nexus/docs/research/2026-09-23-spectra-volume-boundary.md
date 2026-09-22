---
type: explanation
status: archived
audience: contributor
owner: spectra
last_reviewed: 2026-09-23
---

# SPECTRA repeated 100–110 volume display stall

Diagnostic and execution evidence, not implementation or release authority.
Baseline: `f14cb321`, initially clean workspace. The follow-up user request
authorizes SPECTRA test/information cleanup and business/UX repair.

## Baseline observation and confirmed mechanism

The user reports a small stall on every 100–110 crossing, across websites and
input methods. The number stalls; an audible interruption is uncertain.

- [Boundary predicate](../../packages/contracts/src/audio.contracts.ts) uses only
  `(from > 100) !== (to > 100)`, without physical processor lifecycle evidence.
- [Popup state](../../apps/extension-spectra/src/popup/card/state.ts) saves the
  previous value in `volumeTransitionPresentation` on a crossing.
- [Popup rendering](../../apps/extension-spectra/src/popup/card/render.ts)
  returns that saved value until the transition clears. The state comment says
  only colour is held and the number is optimistic; the renderer contradicts it.
- [OSD](../../apps/extension-spectra/src/content/ui/osd.ts)
  `resolveHotkeyVolumeTarget` returns the previous payload on a crossing.
- The current coordinator retains the processor on a down-cross. The numeric
  boundary therefore does not prove a physical route transition. Repeated warm
  crossings still receive the display freeze.
- The local `dist/popup.js` contains the same saved-value rendering branch.
  Chrome Default profile preferences register the unpacked extension at this
  repository's SPECTRA `dist` directory. Preferences and disk content do not
  prove the code generation loaded by an already-running page.

## Reproduction and evidence limits

Using repository-pinned Bun 1.4.0, in `apps/extension-spectra`:

- `bun test test/popup-coalescing.spec.ts`: 14 passed. The boundary reversal
  test explicitly requires the displayed value to remain 100 before ACK.
- `bun test test/scalar-feedback.spec.ts`: 7 passed. Boundary gestures retain
  the previous complete presentation.

These tests establish the deterministic display mechanism, not browser latency
or audio continuity. No millisecond stall measurement or live audio recording
was obtained. The connected computer-use surface exposes only an empty Codex
in-app browser, not the user's Chrome session.

## Repair and verification

- Removed Popup/OSD numeric-boundary freezes and their unused contract helper.
  Requested values render in the input task; colour remains acknowledged lifecycle.
  Pending volume intents also survive older same-document snapshot broadcasts.
- Real Chrome regression: the new first-visible-OSD assertion failed against the
  baseline artifact (100 instead of 110) and passed against the rebuilt candidate.
  Reversal, processor reuse and rejection are covered by focused runtime tests.
- Actual browser OfflineAudioContext rendering repeatedly changes production
  AudioGraphRouter gain 100–110 without silent render quanta, source duplication
  or topology replacement. This is graph continuity evidence, not a measurement
  of live tabCapture startup, operating-system output, or the user's open page.
- Final production build and four-package canonical typecheck passed. All 108
  default unit/contract/runtime test files and all 42 Chrome smoke scenarios
  passed. The strengthened post-release speed observer also passed separately.
  Real Chrome accessibility passed 2/2; strict application lint, architecture,
  public projections and document gates passed.
- Retain existing security, permissions, document identity and source ownership.
  No unrelated HALO, global configuration, commit, push, or publication scope.

Separate requested numeric feedback from acknowledged processor state. A
numeric threshold alone must not freeze feedback or imply processor startup.
Preserve actual-state ACKs, failure correction, gesture identity, and stale-ACK
fences. Replace tests that require a frozen number with held-processor crossing,
genuine first activation, reversal, and failure cases. Do not add another
processor hold, timer, prewarm path, or optimistic lifecycle owner.

The shared operation previously awaited sticky badge-use storage and badge
reprojection before its ACK. Those presentation effects now use the existing
per-tab projection queue. Audio-session broadcast and Capture badge paint also
follow durable commit without delaying physical ACK. Barrier tests hold these
optional effects unresolved and prove the durable operation still acknowledges.
No latency share in milliseconds is inferred from this ordering repair.

The durable session queue and presentation queue must also be distinct: detaching
an individual broadcast promise is insufficient if the next durable operation
is still queued behind that broadcast. A barrier test holds the first projection
and observes the second durable commit and ACK before releasing presentation.

Real Chrome exposed a separate final-input lifecycle defect: after submitting
80%, staging 90%, and destroying the actual Action Popup while its first ACK is
held, the page remained at 80%. A simulated `pagehide` in a surviving test realm
did not prove handoff. Repair moves continuous input ownership to Background
before the Popup can disappear; its real-destruction regression remains the
acceptance criterion. The rebuilt real Action Popup now reaches 90% after its
realm is destroyed; typed Port and partial-failure/ordering tests cover the
remaining lifecycle edges.

Information cleanup preserves the existing v2 wire ABI. Already-running Content
guards require four OSD message fields, although current Content only consumes
`muted`. The producer therefore retains the required localized wire fields;
current runtime projections and unused Popup formatting functions are removed.
Both new guards and an independent legacy guard accept the current producer.

The full Chrome run also exposed a cold-bootstrap observation race. Listeners
and bootstrap status existed before the HELLO initialization verdict returned,
but native volume/mute events during that window were discarded. No second event
meant no persisted state. The repair retains the latest observation until HELLO
selects the lean or heavy runtime owner. Two deferred-HELLO tests verify latest
lean submission and zero duplicate submission after heavy-runtime takeover,
without sleeps or forcing heavy runtime activation. The original real Chrome
recommendation-mute scenario now passes in the full suite.

Verification execution was simplified after a real Chrome inventory benchmark
was found inside the default test matrix. Its two 35-second MV3 idle waits are
intentional performance evidence, not a lifecycle leak. It passed in the full
109-file run and now belongs explicitly to `test:performance`; the default
matrix contains 108 files. No benchmark coverage was deleted.

The browser test previously froze the requested speed after key release. Its
final oracle now permits one correction to physical playback rate, retains
immediate requested-value and in-gesture animation assertions, and observes two
further animation frames before stopping the mutation probe. Release still
retires unsent repeats; this correction does not authorize new physical writes.

Retained evidence consists of this diagnosis, the exhaustive baseline test
ledger, and the dated production-artifact archive. Temporary pagehide/fake-RPC
experiments were replaced by the real Popup-destruction and typed Port tests.
At that initial local checkpoint, no commit, push, release, installation, or
user-browser extension reload had been performed. The production `dist` is rebuilt; an already-open user
page may still run an older generation.

Revalidate after a renderer, OSD, coordinator, graph, or loaded artifact change.
Keep this diagnosis scoped: no repository-wide audit or performance claim.

## Automatic Capture detection regression follow-up

The user clarified that detection means deciding whether SPECTRA needs to capture
the page audio to control it successfully. The cleanup incorrectly hid automatic
records and changed the route conclusions to generic compatibility language.
Both sources and the original “Capture when needed / Direct” semantics are restored.

Execution inspection also found an existing authority loss: live automatic SAFE
evidence was assigned to `state.mediaRoute = direct`, so the mode executor treated
a failed automatic binding as a manual prohibition on Capture. Policy now carries
only the user constraint in that field; physical failure may fall back under the
existing one-shot admission. The regression must exercise policy through mode
execution rather than constructing a mode state with the source already omitted.

The supplied Douyin page exposed safe same-origin blob sources alongside an empty
media placeholder. Counting the placeholder as an output source prevented a full
WebAudio proof. The registry now owns the selected processing-source set shared
by detection, binding and source-count ACK; object-backed sources remain included
and cannot inherit stale URL evidence. Source changes still invalidate coverage.

Validation completed: 22 policy/mode cases, the default 108-file matrix, 42 full
Chrome smoke cases, four Chrome component/accessibility cases, production rebuild
and the four-package canonical SPECTRA typecheck. Repository delivery gates remain
owned by the commit/push hooks. The initial isolated Douyin probe
could not obtain a real user invocation grant; the user's Edge instance could not
be inspected because Computer Use stopped on uncertain browser URL identification.
Neither probe proves that the user's actual audible failure has been resolved.
The user has now explicitly authorized commit and push after repair and validation.

Independent review extended the same repair to failure and asynchronous source
changes: retire old graphs before reporting bypass, preserve a Capture owner
whose stop failed, and reject WebAudio ACKs against an obsolete processing-source
set. Each fallback performs only one physical neutralization. Source cleanup runs
for all modes, including the last selected source becoming an empty placeholder.

The rebuilt isolated Douyin run now records `direct/auto` and acknowledges
`actualMode=webaudio`, `phase=active`, `volume=110`, `boost=1.1`. The page was muted
in that run, so this is execution/readback evidence, not audible user-Edge proof.
The temporary probe has been removed after recording these bounded findings.

The full smoke suite is a shared browser journey. Filtering only Capture-named
steps omitted the native fixture setup and produced “requires an observable page
or standard native volume”; that partial command is not a valid substitute for
the canonical full smoke gate. Final integration uses the complete journey.

Final integration exposed an intermittent release-feedback race. An active speed
ACK was discarded by the presentation path; if it arrived before keyup cancelled
unsent repeats, no later ACK existed to correct the optimistic label. The OSD now
retains the latest actual during both active and frozen phases and commits it at
settlement. A bundled real-Chrome component test was RED (`1.2×` retained instead
of `1.1×`) before the repair and GREEN afterward, including post-keyup ACK and
new-gesture fencing. The full journey observes the requested target before keyup
and the actual value afterward, so a fast correct settlement cannot fail an
assertion that accidentally demands the old prediction after release.
