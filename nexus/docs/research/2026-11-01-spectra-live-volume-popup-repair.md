---
type: explanation
status: stable
audience: developer
owner: spectra-media-control
last_reviewed: 2026-11-02
---

# Live volume and Popup observer repair

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
