---
type: explanation
status: stable
audience: developer
owner: spectra-control
last_reviewed: 2026-11-01
---

# Speed toolbar actual-rate projection

## Follow-up: physical speed and unmute admission

User readback after the first repair: the toolbar now shows a number but it is
not the requested free speed. A live Douyin stream also reports Chromium's
"unmuting paused the element before document interaction" warning at the sole
native muted setter. The installed Edge extension metadata resolves the reported
ID to this workspace's `dist`, and its reported line 4772 matches the current
bundle's muted assignment. This is not evidence of a different install path.

Source inspection found two independent boundary defects:

1. Page-speed acknowledgement stabilizes only the controller getter. A regression
   even accepts controller=1.5 while media stays at 1 indefinitely. Cold and full
   runtime observations also prefer that getter. Toolbar reads the physical
   media, so those channels can disagree while the request claims success.
2. Preset restoration for a non-default speed also includes default
   `mediaMuted:false`. The common writer has no document-activation admission;
   Chromium can pause muted autoplay without throwing from that assignment.

Follow-up implementation plan (same owners and write scope):

- [x] Add regression vectors for physical/controller disagreement, delayed
  physical convergence, free-rate fallback after an already owned page writer,
  and restoration of the original baseline.
- [x] Make physical DOM speed the observation authority; require both witnesses
  for page-speed confirmation. Preserve cancellation, baseline restoration,
  exact ownership identity and terminal security failures on route transition.
- [x] Gate unmute at the common writer before page or DOM writes, keep mute and
  other speed/volume fields independent, and suppress blocked automatic replay
  until document activation changes.
- [x] Use real Chrome without the permissive autoplay flag to prove muted
  autoplay keeps playing, speed restore succeeds, and a later trusted page
  interaction permits explicit unmute. Rebuild and record exact results.

Follow-up results: 68 focused unit tests passed. The built-extension Chrome run
passed all 18 tests (10 toolbar/physical-policy cases and 8 bootstrap lifecycle
cases). The free-rate case now exercises `1.5 -> 1.3 -> 1.4`, with toolbar, DOM
and ACK agreement at every step; the unit suite additionally proves
`4 -> 5 -> 1.75 -> release 1`. Controller and physical baseline are separate
witnesses: restoring the former must not require it to support an old DOM-only
rate. A controller-only bounce at the last rendering boundary was reproduced
as RED and now passes; the boolean result of the reused settle helper must be
checked, not discarded.

The autoplay case serves a real audio-bearing media source and removes the
permissive autoplay-policy flag. Its passive CDP reads explicitly set
`userGesture:false`: installed Puppeteer `ExecutionContext.js` uses
`userGesture:true` for ordinary evaluate/$eval, which otherwise grants the very
activation the test is supposed to lack. Before interaction, the fixture stays
muted, playing and at 1.3x; an unmute returns the typed activation failure
without touching the setter. A trusted page click then permits explicit unmute.

The bootstrap revision is now 1.3.4 and the heavy runtime revision 3.6.1 so the
existing lifecycle owner can reject stale loaded implementations. Both remain
projections of the single contract owner. The current development build and
dist integrity passed, as did canonical SPECTRA typechecking and six-file strict
Biome. The pre-existing global verifier errors remain separately recorded below;
no unrelated Popup changes, browser settings, dependencies or public repository
were modified. Final documentation validation is recorded by the strict gate.

Independent read-only review caught the final-boundary boolean and distinct
baseline issues before final delivery. Preserve those two regressions when
changing acknowledgement timing or page-writer handoff again. Freeze source
after that boundary review before final build/type/browser checks; unchanged
dependency type evidence is reused by the canonical Turbo owner.

## Problem and evidence

The live Douyin modal has two separate nodes: toolbar
`.xgplayer-setting-playbackRatio` says `倍速`, while menu
`.xgplayer-playratio-item.select` says `1.0x`. Multiple players coexist.
Earlier bridge probes asserted only the selected menu item, including `null`
for unlisted rates. They did not exercise the visible toolbar on first open.
The host-managed browser confirmed this DOM without changing login gates or
calling a controller setter. The original root-cause report remains historical
evidence of the controller problem, not proof of first-open label correctness.

## Accepted repair and ownership

- The declared registry names the exact toolbar text and player root.
- The isolated bootstrap owns one actual-rate label projection for its lifetime,
  independent of heavy-runtime acquisition/release. MAIN remains synchronous
  and observer-free. The selected menu audit stays independent; our own text
  cannot certify a controller ACK.
- DOM ready/warm injection/pageshow take an initial media read; native media
  events bind new players and update actual rates. A native MutationObserver
  restricted to each discovered player root handles late labels and React text
  replacement. There is no document topology observer, timer, polling, extra
  injection entry, controller write, dependency, or option synthesis.
- Bind only one media element in the same closest declared root; refuse
  ambiguous roots. Project the positive finite `playbackRate` without rounding
  or looking up an option. Preserve the existing text node and controls.
- Prune disconnected roots on media activity and observer delivery; every new
  binding prunes retired roots. Bootstrap disposal disconnects all observers
  and restores only still-owned text. No new binding can accumulate retired
  roots, and no queued observer may write after disposal.

Native DOM observation already supplies the required semantics. The existing
bridge owns page-controller readback; its current projection data supplies
site identity. A UI framework or observer library would add no missing runtime
capability. This extends that owner rather than adding a generic watch engine.

## Acceptance and progress

- [x] Inspect live DOM and preserve existing unrelated Popup changes.
- [x] Implement separate actual-rate toolbar projection in the existing owner.
- [x] Prove cold first frame, unlisted rate, late mount, React replacement,
  independent players, heavy runtime, disposal, and unrelated-host isolation in
  built-extension Chrome tests.
- [x] Run affected unit, type, build, architecture and documentation checks;
  record results and limitations here.

## Validation results and remaining boundaries

- `bun run build:dev`: generated the current development `dist`.
- `bun run check:dist`: all 12 entrypoints and manifest references present.
- `bun run typecheck:spectra`: four package owners passed on the final production
  TypeScript revision; no parallel compiler or fallback command was introduced.
- Strict Biome on the seven changed TypeScript/fixture files: zero diagnostics.
- Focused native-media, declared-adapter, native-write-policy and registry tests:
  48 passed. Registry plus runtime-loader tests: 29 passed (the registry's nine
  cases overlap the first run).
- Built-extension Chrome, `speed-toolbar.spec.ts`: all seven cases passed,
  including first-frame `1x` without any ratechange event, unlisted `1.3x`,
  arbitrary `2.35x`, late/replaced labels, two players, ambiguous-root refusal,
  nested-control preservation, resident/released runtime, warm replacement,
  disposal, and unrelated-host isolation.
- Built-extension `runtime-bootstrap.spec.ts`: all eight cases passed, including
  reinjection, worker restart and extension invalidation cleanup.
- The combined three-file Chrome run ended **19 passed / 7 failed**. The seven
  `page-media.spec.ts` cases using real Action Popup intent submission timed out
  waiting for its browser target (`openActionPopupTarget`, 10 seconds). The
  other four page-media cases passed. No assertion was relaxed or route replaced.
  This run does not certify the full media suite.
- `bun run docs:check`: all 129 documents passed, including this result record.
- `bun run verify:q`: **9 errors / 7 warnings**. A read-only baseline replay
  substituted HEAD text only for the four task-owned production source files
  while retaining pre-existing Popup dirty work, then ran the unchanged verifier.
  It produced exactly the same nine errors and seven warnings. No baseline file
  was written and no working source was reset. Existing failures include stale
  MAIN discovery literals/domain restrictions, the registry comment matching the
  playbackRate writer scanner, Popup scrollbar ownership, Chinese comments,
  public parity and two sender checks. These gates remain unresolved.

The live-site observation verified the real DOM shape; the behavior tests used
the built extension at a locally intercepted declared origin. The user's running
browser has not been reloaded or certified with this build. This is a local
repair and validation record, not release or live-user-browser certification.

Follow-up root-cause work is explicitly retained in this workspace: diagnose the
repeated Action Popup target timeout through its browser/runtime owner, and
reconcile the pre-existing verifier failures with their canonical owners. Do not
silently replace popup intent submission with direct messages or loosen checks.
Popup files already dirty at task entry remain user-owned and untouched.

Process audit: use the exact first-frame toolbar as the regression oracle;
selected menu items alone missed the reported behavior. Keep UI mounting,
controller ACK and actual media rate separate. Disposal tests wait for the native
ratechange event rather than background-tab rAF, which can be suspended. The
focused suite closes in seconds; broad popup timeouts are recorded separately.
The HTML fixture and Chrome regression are permanent test assets. The repair
record and generated development `dist` are intentionally retained; no temporary
source copy, dependency, external setting or browser profile is retained by this
task.

Behavior authority: [media controls](../../apps/extension-spectra/docs/control/06-media-and-video.md)
and [runtime](../../apps/extension-spectra/docs/architecture/runtime.md).
