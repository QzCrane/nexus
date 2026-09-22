---
type: explanation
status: stable
audience: developer
last_reviewed: 2026-09-23
---

# Live and recorded media route isolation

## Follow-up: rejected neutral hold and repeated transitions

The user rejected candidate `54d8805a`: returning to 0–100 must release Capture
when volume enhancement is its only demand, and repeated transitions must work
without reloading. The prior candidate's neutral hold is not approved business
behavior. Its passing tests asserted the wrong requirement and used a reload to
exit the held session. The historical hold description below is superseded.

Repair and verification:

1. Remove sticky processor demand and stop emitting hold intents; preserve
   independent non-neutral DSP and safe page analyser demand.
2. Change the existing built-extension regression to require real neutral release
   and repeated re-entry on one document, without a restorative reload.
3. Trace repeated volume/page transitions through target identity, Capture
   admission, generation and physical stop/start readback; fix demonstrated
   failures in their existing owners.
4. Update the canonical state contract, run browser and applicable repository
   gates, independently review, and deliver the verified candidate.

Two old-artifact failures were reproduced before changing the browser oracle:
`350 -> 80` retained physical Capture despite neutral boost, and an unsafe
`srcObject` at neutral volume acquired Capture after a visible Visualizer's
delayed retry. Default Visualizer observation was a second independent source
of Capture demand. Removing hold alone could not restore the requested behavior.

The canonical policy now requires enabled, non-neutral DSP for Capture. The
Visualizer may use a proven safe page analyser or observe DSP-owned Capture,
but cannot mint admission or extend Capture lifetime. Unsafe neutral subscribers
settle on bypass without acquisition retries. A failed neutral page-analyser
handoff also executes the existing acknowledged Capture stop path. Stop failure
remains a retained physical owner/error, never an optimistic idle state.

The old optional v2 hold/admission fields remain decodable but have no execution
authority. Runtime revision `3.6.0` forces the existing loader to replace older
Content implementations. Both envelope validators accept observation without a
Capture grant and still validate the identity of any legacy supplied grant.
The full browser suite caught a missed optional-field decoder during this repair;
the decoder and its no-grant boundary tests were corrected before delivery.

Browser regressions require one document without reload: three `350 -> 80/0/100`
cycles, and a continuously subscribed default Visualizer across
`110 -> 50 -> 110 -> 100`. Assertions cover DOM volume, Content and session ACKs,
offscreen graph retirement, and distinct starts on re-entry. These use a real
browser and synthetic MediaStreams; they do not measure the user's current
Douyin stream or audible output. Existing same-document path-rule tests remain
part of the full suite. No new site-name special case, permission or dependency
was introduced.

Verified candidate: production build and artifact integrity pass; all 109 isolated
SPECTRA unit/contract/runtime test files pass, with the final foreground-acquisition
guard additionally covered by the 50-test coordinator suite. The final built
extension Chrome suite passes 47 tests / 490 assertions, including real Popup
subscription acceptance/release, safe analyser pixels, repeated Capture cycles,
worker replacement and navigation disposal. Independent production review has no
remaining blocker. Repository push gates remain mandatory for delivery; actual
sound in the user's live Edge tab requires user readback.

User readback now confirms repeated Capture exit works. Delivery remains open:
the card still flashes blue/purple during transitions instead of changing once.
Trace real Popup color mutations and the ordering of audio-session lifecycle,
control snapshots and settlement ACKs; fix the projection owner and retain the
continuous-transition regression. The architecture gate also required the
retired Visualizer Capture grant; replace that obsolete positive requirement
with neutral-observation and no-admission invariants, without bypassing the gate.

Color repair identified three concrete stale projections: carried old processor
fields overwrote newer session lifecycle; the first control snapshot cleared a
known exact-runtime Capture when session identity was not available yet; and
initialization unconditionally preferred a cached session over a newer settled
runtime read. The first issue has independent RED cases in both directions.
The repair consumes only advanced processor field revisions, preserves known
same-document runtime evidence and chooses the newest settled initial lifecycle.
Actual Capture remains the meaning of purple; no threshold-based prediction or
timer-based color masking is introduced. Real Popup mutation/frame traces retain
the requirement that each completed transition changes color once without a
later reverse flash.

The initial-color defect was also reproduced in the built Chrome extension by
returning an older same-document session only from the Popup's session-read RPC,
while the real Content runtime retained its newer settled state. The old build
painted purple for a newer bypass runtime. The corrected build passes both
directions: mutation and animation-frame traces from the first visible card
contain only blue for newer bypass and only purple for newer Capture. All other
RPCs and physical processor operations remain real. This is controlled stale-
read evidence, separate from confirmation in the user's existing Edge session.

Final color candidate: all 109 isolated test files pass; the rebuilt production
Chrome suite passes 48 tests / 496 assertions, including the two-direction
first-visible-color oracle and the uninterrupted Capture transition traces.
The six-package typecheck, strict lint, documentation and updated architecture
owner pass; independent incremental review reports no remaining blocker.

Baseline: `3f07c73b`. The user reports that Douyin live playback changes the
displayed volume without changing sound, with Capture shown across the whole
volume range. The recorded-video page works natively and is disrupted by forcing
Capture. Both can be presented under `www.douyin.com` in the user's navigation.

## Evidence boundary

- At baseline, route persistence and manual matching used hostname only. They could not
  express different rules for `/follow/live/` and `/jingxuan`.
- Current effective volume keeps native `volumeBase` and processor `boost`
  separate. A processor held after crossing 100 stays active at neutral gain
  below 100; native volume still owns attenuation. Purple therefore does not
  prove that Capture owns the entire volume scale.
- Independent browser navigation of the live URL redirected to
  `live.douyin.com`. Its visible video uses a MediaStream with live audio and
  video tracks. The player volume accessor delegates to that video's volume.
  This is not the user's existing Edge tab and does not establish the failing
  target, output amplitude, or Capture session in that tab.
- A missing full-range Capture gain is not yet a demonstrated cause. Changing
  graph ownership before establishing the actual writer failure would expand
  semantics beyond the evidence.
- Reproduced in built-extension Chrome with a visible `srcObject` video and a
  later hidden stream preview: requesting 40 left the main video at 80 and wrote
  40 to the preview. Two owners contributed: passive play/native events stole
  selection, and `replayDesired` sent restore intents for every registered source,
  whose ACK then replaced Background's active target. Fixing only selection still
  failed. Restricting replay to the selected target and notifying actual selection
  changes made the same test pass: main 40, preview unchanged at 25. This proves
  the physical target regression, not the user's live audible output.
- A real Chrome path-rule regression established that after `history.pushState`,
  `MessageSender.url` remains the initial document URL while `sender.tab.url` and
  `webNavigation.getFrame` report the current route with the same document ID.
  Resolving path rules from `sender.url` therefore returned `auto` despite a
  persisted matching user rule. Current-frame URL readback must verify sender
  document identity; a Content-supplied URL must not become route authority.
  After the current-frame repair, the same real-browser test passed: rules saved
  through Popup and same-document live/video/live-child navigation resolved
  capture/direct/capture, with query parameters excluded from the saved scope.

## Implemented target boundary

Passive playback uses the existing candidate ranking. Native volume/rate/seek
events do not imply user selection, even when the browser marks them trusted.
Pointer and fullscreen target selection remain explicit. Desired-state replay
only applies to the selected target; inactive registrations remain observations.
Ended media and paused or hidden video lose historical pointer priority when a
new playback candidate is selected. Audio-only selection remains independent of
geometry. Unit/native suites passed 28 cases. Six focused real-Chrome cases passed,
including a previously clicked feed that becomes hidden or remains visible but
paused before the pre-rendered modal starts, and actual volume property readback
on the visible stream while its hidden preview changes native properties.

## Route scope

Manual rules gain an optional canonical URL path prefix. Native URL parsing owns
normalization; queries and fragments are not persisted as route keys. Matching is
hostname specificity followed by segment-boundary path specificity. Existing
hostname rules and automatic hostname evidence remain supported by the same
SettingsRepository. New typed rule messages preserve the existing strict v2
registry projection; Content route queries derive their URL from the browser
sender identity and current-frame readback rather than an untrusted requested URL.

SPA navigation refreshes the current route through the policy queue and retires
the previous page's neutral processor hold. The same-page hold still avoids
rebuilding Capture on every 100/110 crossing. This does not transfer attenuation
ownership from native volume to Capture or bypass Capture admission.

## Validation and review

- Production build and artifact reachability passed: 85/85 files reachable, no
  duplicate artifact. No dependency or browser permission was added.
- All 109 isolated unit, contract and runtime test files passed.
- Full built-extension Chrome and diagnostic privacy regression passed:
  46 tests, 452 assertions, including the preview target and live/video path
  cases, Capture lifecycle, extension reload, presets and speed restoration.
- Independent review closed stale hydration, concurrent rule projection,
  navigation epoch and Capture admission findings. An already-issued physical
  stop remains real; navigation never invents permission to restart Capture.
- Removed three source-name assertions that required the old registry client
  function names. Actual UI mutation, persistence and route readback now cover
  that behavior; the old strict v2 shape remains covered by protocol tests.
- Documentation checks passed for 108 Markdown files. Architecture checks passed
  with the existing coordinator length signal and a new 1026-line settings
  repository review signal. The repository deliberately retains one serialized
  persistence/revision/capacity owner; no second store or artificial split was
  introduced merely to suppress the signal.

Use the existing browser smoke owner with an explicitly foregrounded Popup when
testing extension UI. Background-tab loading can otherwise obscure the actual
rule failure behind a harness timeout. Navigation URL authority needs real
Chrome evidence: a fake sender that updates its URL would miss the established
SPA bug.

Live sound control is unverified until the user's reproduction or a physically
equivalent real-browser output measurement confirms it. A changed label, native
property, mocked ACK or active processor by itself is insufficient evidence.
