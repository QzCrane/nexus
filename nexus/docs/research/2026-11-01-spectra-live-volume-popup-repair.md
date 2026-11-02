---
type: explanation
status: stable
audience: developer
owner: spectra-media-control
last_reviewed: 2026-11-02
---

# Live volume and Popup observer repair

## Follow-up: retained video speed and Popup playback

The reported 2x video → live room → original video regression adds a boundary
the earlier reverse-close fixture did not exercise: the returning element may
have lost ownership and been reset to 1x without a source revision change.
Applied desired revisions must certify one selection visit, not every future
visit to that source. Active same-visit page changes still take precedence.

Popup playback has separate stale-ACK, durable-read and mutation-baseline
boundaries. Its `playing` value means `!paused`; the `play` event and physical
getter can prove that intent while buffering, before `playing` or the native
`play()` Promise completes. The native ACK deadline and cancellation must also
bound an unresolved write Promise, so the actor and subsequent pause cannot hang.

- [x] Regress selection revisit after ownership loss and a rejected live speed.
- [x] Reconcile cold Popup playback from the current document and toggle from
  native current state; keep older ACKs behind the common render fence.
- [x] Bound native Promise/event ACK and prove buffered play → pause in Chrome.
- [x] Unify the template lease across initialization, successful control,
  worker recovery and release; fence late probes against navigation/release.
- [x] Complete final owner/gate validation on the frozen artifact.

Reuse native media events, Promise.race and existing identity/ACK owners. A state
or queue library cannot own SPECTRA's source/selection authority and would add a
second owner; no package or new retry/polling mechanism is needed.

The full Chrome regression also exposed the missing template consumer: a page
ratechange released physical ownership, then the runtime unloaded even though
its document desired still needed to restore later selections. The repair keeps
one document-template lease separate from field ownership. It also replaces the
old initialization/restart `settings:<hostname>` lease with that same capability.
Content reports `unset/retained/released`; same-document worker reinitialization
cannot replay live 1x resource actuals over a retained 2x template or recreate a
released template. Late status replies are read-only and cannot revive leases
after navigation or page-settings release. Release decisions contain no desired
values, are cleared only by a new successful intent, and retire with the document.

The built Chrome regression now uses a real rate-capable WAV video, resets its
same-source rate to 1x, opens a Canvas MediaStream that rejects 2x, restarts the
worker, and returns to the original video twice at physical 2x. It then invokes
restore-page-settings through the real Action Popup and observes runtime READY
become false after all consumers leave. A real empty MediaSource proves that
buffered play and subsequent pause remain operable; durable-only and cached
Popup reopens confirm the page's current paused state before the first card paint.

Process correction: the earlier close fixture changed speed successfully inside
the live modal, so it did not cover an unsupported live stream after the page
had erased the original source's ownership. Keep that distinct vector instead
of relying on a matching label or adding arbitrary sleeps/retries. Source-only
selection, template residency, worker restoration and buffered play are separate
proof boundaries. No new dependency, watcher, persistent profile or diagnostic
script is retained.

Final validation: 248 focused unit tests / 1,189 assertions and 48 built-Chrome
tests / 282 assertions pass. The canonical SPECTRA typecheck passes all four
packages (extension ActionKey `178b2d1191da3803`; its program includes `src`, not
the smoke fixtures). Strict Biome passes all 28 changed TypeScript files.
Development bootstrap 1.3.5 / runtime 3.6.5 builds and all 12 dist entrypoints
pass integrity. Strict documentation passes 130 Markdown files / 21 entrypoints.
The native ACK static gate now requires event/getter completion raced against
native write completion and the buffered play regression; its previous literal
`await write()`/`playing` requirement described the very hang being removed.
Canonical verify passes 24 regression tests / 58 assertions and all media rules;
its sole architecture error remains the pre-existing `PUBLIC-PARITY-002` for the
same three missing public files, with seven warnings. The public checkout's
eight pre-existing modified files are untouched.

Broader smoke validation also corrected fixture ownership without changing the
product invariants: the buffered-play test owns its page; preset precedence uses
an untouched origin instead of one with earlier explicit portable adjustments;
the unmute persistence case proves real document activation and complete durable
session projection before stopping the worker; fullscreen page gestures begin
after that document's initialization barrier. Speed observation assertions now
name the physical DOM getter, as the current contract requires. No failed field
ACK, arbitrary sleep or weaker actual-value assertion is accepted as success.

## Completed follow-up: media state and SPA close lifecycle

2026-11-02 audit: the control owners contain field definitions but lack complete
transition/decision diagrams. The system overview still repeats superseded
controller-only ACK conclusions and contradictory adapter admission claims.
Reconcile those projections against the executable owners rather than adding a
second media specification.

- [x] Add a navigable diagram index, field/write-state diagrams and exact speed
  admission/failure/lifecycle rules to the existing control owners.
- [x] Regress and fix returning from a hidden or detached live/modal player to
  an already-playing feed without another `play` event. Keep reads pure and
  protect visible paused media, actual PiP/fullscreen and audio selection.
- [x] Verify the registry, native writer and built SPA close path; distinguish
  fixture evidence from the user's real live transport and playback progress.
- [x] Remove stale current-behavior claims from the system overview; record
  remaining evidence gaps and the exact validation result.

Reuse decision: keep the native IntersectionObserver, media lifecycle events,
existing registry ranking and typed `selected` notification. Existing dependencies
provide no owner for SPECTRA's exact source identity and selection policy;
adding a routing/state library would duplicate that authority. No dependency,
history monkey patch, command-time DOM scan or polling owner is needed.

The control index now routes to five new Mermaid diagrams in the existing field
and media owners, plus the corrected control-flow overview. Remove the obsolete
`applying` field phase and the incorrect claim that speed uses split ACK. The
media owner separates route/document/source, speed admission and failures,
live transport limitations, every meaning of "close", and executable coverage.
The system index no longer repeats controller-only ACK or contradictory online
adapter-admission claims.

The registry regressions failed on the old implementation for hidden, detached
and ended players. Event-owned reconciliation now emits a replacement selection
after a visibility/removal boundary; reads stay pure, visible paused/PiP/fullscreen
and independent audio remain protected. Initial visibility delivery does not
invent a selection change. That distinction was caught by the existing cold
cross-resource Chrome regression: a spurious initial selection had downgraded a
portable restore to a page observation. The final tree passes that original
assertion. Fullscreen exit coordinates selection before its state event, and
the observation flush fences a queued source against the current exact selection
so an old hidden player cannot reclaim Background's target.

An explicit request with no resolvable media previously echoed desired as
applied actual and retained it for later replay. It now returns a field error
with null actual and no new replay template. A targetless restore still retains
its separate template and reports the current absence honestly. Existing
successful desired values survive a later capability failure.

Chrome's real Canvas MediaStream rejects non-1 playback rates, as the W3C stream
contract requires; the negative test verifies error/null actual, physical 1x,
and that the rejected 2x does not replace the established supported baseline on
the next source. The reverse-close tests reuse the existing WAV blob fixture in
video elements to prove a rate-capable source's target handoff and replay. An
empty media shell cannot prove play, and a MediaStream cannot prove arbitrary
speed support. These fixtures do not certify the user's online Douyin transport
or sustained currentTime/wall-clock acceleration.

Final validation: 82 focused tests / 378 assertions and 36 built-Chrome tests /
140 assertions pass. Strict Biome passes all six affected TypeScript files;
canonical SPECTRA typecheck passes four packages (extension ActionKey
`d0eac90fc47a4a40`). Development runtime 3.6.4 builds and all 12 dist entrypoints
pass integrity. Mermaid static lint accepts the six changed/new diagrams; no
renderer acceptance is claimed. Strict docs pass 130 Markdown files and 21
entrypoints with no mirrors. Canonical verify passes its 24 regression tests;
its sole architecture error remains `PUBLIC-PARITY-002` (the same three missing
public files), with seven warnings. This is a separate blocked push boundary,
not a passing gate and not a reason to suspend this local repair. The public
checkout's eight pre-existing modified files remain untouched.

Process closeout: use lifecycle/proof-specific regressions and existing native
fixtures instead of adding a second state/routing engine or treating a timeout
as successful playback. The read-only review caught the old-event/new-selection
ordering race. No new dependency, watcher, diagnostic script or persistent test
profile is retained; only normal ignored dist and tool caches remain.

## Completed follow-up: free-speed bounce

The user reprioritized the live free-speed bounce ahead of the blocked push.
Keep the separate public checkout and its dirty files untouched. The previous
scope question must not suspend an independent, already authorized Nexus repair;
reuse the user's recorded commit/push authorization without another question.

- [x] Trace speed writer selection, settle, rollback and toolbar ownership.
- [x] Reproduce the intermediate physical/label trajectory in built Chrome.
- [x] Admit declared page speed writes by the exact player's offered values;
  send unlisted or unreadable values directly to the existing DOM owner.
- [x] Prove page-to-DOM handoff without a page mutation, preserve supported
  page writes and later controller maturation, and verify the built artifact.

Reuse native DOM queries and the existing declared registry, numeric label
parser, writer and lifecycle. No package, second adapter, optimistic label or
shorter timeout is needed. Record options as selectors, never hardcoded rates.

Root cause: writer discovery proved a setter exists, but not that it can play
the requested value. Every new free value retried that setter, waited through
its 750ms physical/controller convergence budget, restored page and physical
baselines, then finally reached DOM. The existing label truthfully exposed these
intermediate rates. A foreground built-Chrome regression failed on that
trajectory before the repair and passes afterward: consecutive 1.3/1.4 writes
produce only the requested physical rates and labels, with zero page setters.

The registry now owns an option selector, and the existing numeric text parser
is shared by menu observation and value admission. The executor's no-write
handoff retains exact old ownership identity and original release baseline.
Only an actual failed page attempt populates the single-value rejection memo;
an offered option cannot override that physical failure. A previously unlisted
value can become page-admissible when its real option appears later.

The old SPA smoke sampled Background ownership immediately after the page setter
moved the element, before its asynchronous confirmation committed. It now awaits
that exact ACK state before retaining the same controlled/confirmed assertions;
no assertion or production guarantee was weakened.

The real Action Popup test changes the free speed through its input and verifies
physical playback, the site's label, the Popup value and zero page writes.
These are isolated fixtures served at the declared live origin, not a claim of
observing the user's current Edge livestream. Runtime revision is 3.6.3; MAIN
admission data uses the existing declared registry and injection owner.

Confirmation optimization is recorded in `rules.md`: retain existing scope and
destination authorization, ask only for a concrete expansion/conflict, and do
not suspend independent authorized repairs behind a separate delivery blocker.
The earlier public checkout question remains irrelevant to completing this fix.

Validation for this follow-up: 52 focused unit tests / 239 assertions and
33 built-Chrome tests / 122 assertions pass, including the real Action Popup,
first-open labels, live volume, autoplay admission and runtime reload. Strict
Biome passes all nine affected TypeScript files. Canonical SPECTRA typecheck
passes all four packages (final extension ActionKey `5cf563aa321dbe4b`); the
development build and 12-entrypoint dist integrity pass. Canonical verify's 24
regressions pass; its sole remaining architecture error is the unchanged
`PUBLIC-PARITY-002` with three missing public files and seven warnings. This does
not block the local repair and is not reported as a passing push gate. Strict
docs and Git whitespace checks are required before this checkpoint. No browser
profile, diagnostic copy or new dependency is retained; keep the normal build
artifact/caches and executable regression fixtures.

The user reports both directions failing: changing the live site's volume does
not update SPECTRA, and changing SPECTRA does not change live volume. The same
three-card Popup reports `ResizeObserver loop completed with undelivered
notifications`.

## Evidence and owners

- A fresh local Chrome fixture under the declared live origin reproduces the
  first direction: physical volume becomes 0.63, the real Action Popup remains
  at 100 and syncing, while bootstrap reports runtime 3.6.1 ready. No account or
  live stream is modified by that fixture.
- Read-only inspection of the current live player shows `parent._player.proxy`
  with exact `video/media` references and standard 0..1 volume/muted accessors.
  It has no semantic `getVolume/setVolume` pair. The existing DOM route is
  appropriate; adding a site-specific volume writer would not repair the
  missing state propagation.
- The previous unmute guard affects only muted-to-unmuted transitions. The
  effective-volume operation does not add an unmute, restore accepts independent
  field results, and its initialization barrier settles even after failure.
  There is no demonstrated causal link from that guard to both volume paths.
- `popup/frame-height.ts` changes ancestor root geometry synchronously inside
  a descendant ResizeObserver callback. The existing overlay observes that
  root, exposing a shallower notification that cannot be delivered that round.
  Its installer also lacks cleanup on Popup bootstrap retry.
- The smoke harness matched only bare `popup.html`, although the production
  frame owner opens `popup.html?cards=N`. Correcting that discovery predicate
  restores real Action Popup test coverage rather than bypassing authorization.

## Execution plan

- [x] Preserve existing dirty Popup design and earlier speed fixes; inspect
  canonical control, runtime and frame owners before writing.
- [x] Reproduce live-origin volume observation through a real Action Popup.
- [x] Trace the failed actual/snapshot boundary and repair the single owner.
- [x] Prove Popup slider writes physical volume and subsequent page changes
  supersede the acknowledged extension value, including runtime lifecycle.
- [x] Move observer-triggered frame writes to one cancellable rendering task;
  preserve first synchronous sizing, height caps and settings navigation.
- [x] Connect overlay resources to existing Popup attempt disposal without
  changing its visuals or interaction semantics.
- [x] Add three-card startup and navigation browser error coverage, run focused
  gates and rebuild the actual loaded extension directory.

## Reuse and scope

Use native ResizeObserver, MutationObserver and requestAnimationFrame, the
existing frame/attempt lifecycle, and the canonical media registry and control
coordinator. Existing dependencies do not own extension document identity or
Popup sizing. A generic observer library or new volume adapter adds no needed
semantics; no dependency change is proposed. Browser fixtures use the repository
browser-driver and disposable profiles. Preserve unrelated Popup CSS/HTML work.

## Validation

Three causal defects were closed in existing owners:

1. `NativeMediaExecutor` refused registry observations until a native request
   assigned its tabId. Popup's cold passive read can finish before its observation
   lease loads the heavy runtime, leaving that runtime unbound but suppressing
   bootstrap observation. Derive page-observation authority from Chrome sender
   and exact document/target, without requiring a prior write/read request.
2. Detached write proof updated only the local observed cache on drift. That
   could suppress a later native event without publishing the new actual. The
   proof now reuses the normal coherent volume/mute observation path and its
   active-target/ownership gates. A silent-registry-event unit vector proves the
   proof itself publishes the pair, beyond merely changing drift telemetry.
3. Popup rejected an older ACK correctly but failed to retire the local input
   that ACK settled. Its optimistic mask could then hide all newer page facts.
   `throughRevision` now retires settled input independently of snapshot clock
   admission; a deterministic RED-to-GREEN regression preserves the newer actual
   and the newer-input mask boundary.

The live-origin real Action Popup regression proves page 60%, Popup slider 40%,
then page 80% through the actual continuous Port and physical DOM readback. It
passed three consecutive fresh-profile runs before final gate closure. No raw
native intent substitutes for this user-flow proof. Runtime revision is 3.6.2.

The previously unreachable page-media smoke tests exposed two stale assertions:
a same-origin portable speed restore can make the controller baseline 1.5 rather
than fixture default 1, and physical speed observation is now attributed to DOM.
The tests now await the existing document initialization barrier, capture the
actual baseline, and retain exact 4x physical/DOM fallback assertions.

Readiness, physical media, control ACK/snapshot, visible UI and
production build are separate evidence layers. User Edge reload and live use
must not be claimed from the isolated Chrome fixture.

Final evidence on the integrated source and development artifact:

- Focused unit boundary/lifecycle/transport suites: 116 pass, 0 fail, 419
  assertions across 8 files.
- Built-extension Chrome smoke: 31 pass, 0 fail, 113 assertions. Both muted
  playback and playback unmuted by a trusted site click exercise the real Popup
  slider in both directions, without pausing or changing mute implicitly.
- Popup geometry Chrome: 4 pass, 0 fail, 35 assertions. Collect startup errors
  before navigating the three-card document; switch settings twice, then prove
  the actual Action Popup's three cards, 390px width and 600px ceiling. The
  instrumented document is foregrounded so its rAF work is not suspended by
  background-tab scheduling.
- Canonical `typecheck:spectra`: all 4 packages passed on the final production
  source; unchanged compiler inputs were not rechecked after test/doc edits.
- Strict Biome: 14 affected files passed, zero diagnostics/silent handlers.
- Development build passed and `check:dist` confirmed 12 entrypoints and every
  manifest reference. The output contains runtime revision 3.6.2 and the new
  drift publication path.
- `git diff --check` passed. Final strict documentation validation consumes this
  record through the control-state owner link.
- Global `verify:q` remains at the same 9 errors and 7 warnings recorded in the
  [earlier baseline](2026-11-01-spectra-speed-toolbar-sync.md): legacy bridge
  pattern expectations, writer classification, existing Chinese comments,
  public parity and sender-check recognition. This is not a full release-gate
  certification; no public projection or release was performed.

Scope audit: preserve the pre-existing Popup CSS/HTML and scrollbar behavior;
the only integration into those dirty implementation files is scrollbar
lifecycle cleanup and its attempt disposer. Earlier speed repairs remain.
The first requested Git checkpoint (`11d06740`) excluded the pre-existing Popup
CSS/HTML, scrollbar module and Popup entry integration. The user subsequently
explicitly authorized committing and pushing the UI as well. A second checkpoint
includes those four files and their lifecycle cleanup, matching the integrated
working tree exercised by the browser results above.
Temporary diagnostic console writes were removed. Retain the named local
fixtures, regression specs, this record, the development dist and normal
canonical build/type caches. Test browser profiles are disposed by their owners;
no extra diagnostic script, source copy or global setting was retained.

Reusable efficiency correction: Action Popup discovery must accept the canonical
card-count query from the outset; a literal bare-URL predicate silently removed
the real UI from prior validation. Sample a transaction's controller baseline
only after the existing restore barrier, and keep local settlement clocks
separate from actual-state revision clocks. These rules now have executable
regressions rather than depending on chat history.

Hook follow-up: the repository's Windows MSYS failure invokes its existing
direct-Bun fallback. That pre-commit fallback runs Biome but omits the configured
documentation gate; run `docs:check` explicitly for this checkpoint. The durable
repair belongs to the hook owner: one shared gate definition consumed by both
normal and fallback execution, with a failure-path parity regression. Keep that
separate from media behavior and do not disable hooks to push this checkpoint.

## Push checkpoint and remaining gate work

The user authorized all local changes, including the UI, for the Nexus origin
branch `docs/spectra-douyin-speed-sync`. Media fixes are committed as `11d06740`;
the UI and its lifetime are committed as `292c539f`. The attempted normal push
passed lint, platform, toolchain, dependency revalidation, documentation, public
metadata projections and hook smoke. It stopped at the same nine architecture
errors and seven warnings, before any remote branch was created. Do not bypass
the pre-push hook or report these local commits as pushed.

The gate failures need distinct owner repairs:

- The MAIN bridge bounds moved to the declared registry. Update source-evidence
  routing to that owner and preserve enforced discovery ceilings. Its hostname
  access selects declared data, while the transport and controller engine remain
  synchronous; prohibit embedded site branches and observers without rejecting
  the canonical registry admission itself.
- Writer scanning currently treats a comment as a playback-rate assignment and
  the extension Popup thumb transform as a page-video style mutation. Repair
  source/receiver classification through the existing Compiler API; regression
  vectors must still reject real unauthorized media writes.
- Two port binders already reject invalid senders through the canonical
  `popup-document-sender.ts` guards before listener installation. The sender
  checker recognizes only same-file comparisons. Preserve symbol identity and
  fail-closed ordering when teaching the checker canonical delegation; do not
  duplicate runtime checks or grow the delegate baseline.
- Translate public-facing source comments while preserving required Chinese UI
  strings. Do not exempt the files from comment policy.
- Public parity reports three genuinely missing files: the sender guard,
  scrollbar and site registry. Do not grow `knownMissing` or point the checker
  at a different temporary repository to conceal the gap.

The parity target `D:/Project/Nexus/spectra-public` is a separate Git repository.
Read-only inspection found eight existing modified files, relative to its root:
`apps/extension-spectra/src/background/background-rpc.ts`,
`apps/extension-spectra/src/content/core/bootstrap.ts`,
`apps/extension-spectra/src/content/logic/native-media-executor.ts`,
`apps/extension-spectra/src/shared/transport.ts`, `bun.lock`,
`packages/contracts/src/control.contracts.ts`,
`packages/contracts/src/spectra.content-runtime.ts`, and
`packages/contracts/src/spectra.ui-control-runtime.ts`. Preserve all eight.
Updating that repository requires the user's scope decision; no generation,
cleanup, overwrite, commit or push in it has occurred. The existing sync
generator owns candidate creation, and a plan candidate alone cannot prove that
this dirty checkout has converged.

The newly reported live free-speed label bounce is a separate follow-up after
the requested checkpoint/push order. No new speed-timing code is included in
these commits, and the pending issue must not be presented as fixed.

### Local gate repair completed before the public scope decision

Eight of the nine errors above are now closed in the Nexus working tree:

- The verifier reads generic traversal bounds and their clamps from the
  registry's actual owner. MAIN reuses `resolveDeclaredSiteAdapter` instead of
  maintaining another hostname reader, preserving the domain-neutral transport
  rule and the existing registry host-boundary tests.
- Writer classification uses the already installed `typescript-compiler-api`
  Program, SourceFile and TypeChecker from the application's real tsconfig.
  Comments and strings cannot become assignments. A known scrollbar div is
  distinct from a media receiver; broad element, union and unresolved receiver
  types remain conservative. Dot, bracket and compound writes stay detectable.
  No writer path is added to an allowlist.
- Port admission resolves the canonical guard's declaration and imported path
  constant through compiler symbols, checks rejection before this exact port's
  listener, and rejects changed forwarders, early true returns, strict-check
  decoys, reassigned ports and unguarded second binders. The canonical verify
  commands execute both verifier regressions and the actual sender guard tests;
  this syntax recognition is not a general control-flow proof. Prebuild now
  calls that same command, avoiding a second entry that omits its tests.
- Public-facing comments were translated while runtime Chinese labels and
  matching data remain unchanged.

Reuse decision: the repository already pins the Compiler API for source analysis
and distinguishes it from the native typecheck CLI. Native text matching cannot
establish alias identity or DOM receiver type; another parser, resolver or
ts-morph layer would duplicate those semantics. No dependency or lockfile was
changed, and no compiler snapshot is cached across verification invocations.

The browser rerun exposed two test synchronization defects. A same-document
restore snapshot may carry either its page-write ACK attribution or a subsequent
physical DOM observation attribution; that test now requires confirmed ownership,
desired=actual=2 and its existing independent controller/physical evidence,
rather than conflating those clocks. Its separate capped 4x test retains the
exact DOM fallback assertion. One initial patch matched that adjacent test by
mistake; it was corrected using the enclosing acknowledgement/snapshot anchors.

Popup geometry previously used fixed sleeps, accepted at least one card, and
could call two unchanged reserved heights settled before inventory committed.
It now establishes exact live inventory, persisted media facts and Chrome's
announced card count, waits for `spectraReady`, and samples the frame only when
its height matches the capped content height. The first repeated opens compare
the same two-card shape. All original physical dimension assertions remain.
Run browser suites sequentially: a concurrent run also observed a worker status
read returning no response; that was not changed or counted as a passing run.
The final isolated sequential run includes that restart case and passes.

Final evidence for this gate-repair tree:

- Canonical verify regression phase: 24 pass, 0 fail, 58 assertions; architecture
  phase: exactly one error, `PUBLIC-PARITY-002`, and the same seven warnings.
- Affected application unit suites: 40 pass, 0 fail, 143 assertions.
- Built-extension media/bootstrap Chrome: 31 pass, 0 fail, 113 assertions.
- Actual Popup geometry Chrome: 4 pass, 0 fail, 35 assertions.
- Strict Biome: 13 affected files, zero diagnostics and silent handlers.
- Canonical SPECTRA typecheck: all four package owners passed on the final
  production TypeScript source; unchanged compiler inputs were reused after
  verifier, test and documentation edits. Development build and dist integrity
  passed with 12 entrypoints. No new speed-timing behavior is claimed.

The public repository, its eight modified files, parity baseline and destination
selection remain untouched. Until that scope decision and parity repair settle,
the private push is blocked. Keep all local work committed; do not disable the
hook to deliver it. Virtual compiler fixtures exist only in memory. Retain the
regression test, this record, development dist and normal build caches; no new
helper daemon, filesystem watcher or diagnostic source copy was created.
