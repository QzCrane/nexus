---
type: explanation
status: draft
audience: contributor
owner: spectra
last_reviewed: 2026-09-23
---

# SPECTRA controls not settling after extension reload

Follow-up to `220c41b6`. The user reports changing Popup numbers without physical
volume changes, no error, no Capture purple state, and Reset/Save/Global Preset
not completing. They explicitly confirmed extension reload. This investigation
does not supersede the historical volume-boundary report or establish a live fix.

## Evidence and execution

1. Confirmed and repaired a disconnected Popup `flush` creating a waiter after
   `close` had already rejected the earlier waiters. Deterministic regression
   failed before the closed guard and passed afterwards.
2. Confirmed and repaired an unbounded optional runtime-status probe before
   `loadRuntime` creates its existing READY deadline. A held read prevented all
   concurrent ensures from reaching injection. The replacement reuses kernel
   `createSettlementPool` and `observeWithin`, retaining physical permits and
   ignoring late read ownership. Regression verifies one injection for concurrent
   callers and actual final runtime release despite a late source-owner report.
   Browser messaging has no native cancellation contract; a bare timeout race
   would not provide the existing pool's physical capacity and observer cleanup.
   No new dependency or alternative initialization/write owner is introduced.
3. The user's local diagnostic snapshot showed a responsive Background and
   declared scripting/tabs/broad-origin grants, no active audio processor, one
   media-discovery probe pending about 114 seconds and ten stale discoveries.
   That probe is a different request from runtime-status. It proves a long-lived
   browser operation, not which stage blocked the user's volume request.
4. Existing diagnostics could not distinguish control acceptance, Content RPC
   waiting and runtime loading. Their existing owner projection now exports only
   aggregate counts and durations for these stages. No periodic logging, storage,
   page identity or telemetry was added.
5. The second user export still lacked the new fixed Background counters although
   the disk artifact contained them. The Options URL identified the same extension.
   After disabling and enabling SPECTRA, the user reported most controls recovered.
   This supports stale Background/new Popup mismatch as the actual broad outage;
   it does not establish the optional probe as the live incident's sole cause.
   The private Port now requires a session-bound ready acknowledgement within five
   seconds. Failure rejects waiters and retires optimistic values visibly.
6. The remaining speed reset had a separate confirmed cause: Popup projected 1.00
   while `RESET_AUDIO_TARGET_PATCH` omitted speed. An old test expressly required
   that omission. Reset now writes speed 1 in the same transaction, carries its
   actual value to the processor and compensates the original speed on failure.
   Real Chrome first failed with playbackRate 1.75 after a visually successful
   reset; the repaired artifact passed with physical playbackRate 1. The user
   subsequently confirmed speed reset works in their actual Edge profile.
7. Independent review found duplicate failure presentation between Port failure
   notification and rejected flush consumers. They now share one causal error;
   the card failure owner marks it reported before Promise reactions run. Save,
   reset and continuous-control consumers preserve settlement without presenting
   that same failure again. Explicit disposal removes listeners before disconnect.

## Validation and remaining boundary

- Focused runtime-loader and Popup transport suites: 26 cases passed.
- Isolated Edge on the previous artifact reproduced reload without navigating the
  original media page, then physically changed native volume and reset it.
  Latest-value delivery after Popup destruction and global-preset saving passed.
- The exploratory Edge reload test disabled the optional visualizer so this native-control case
  does not claim a browser Capture invocation grant. Reload also retires the old
  debugger worker; the experiment opened the real action via a fresh extension page.
  It was not retained in the general Chrome suite: current test Chromium disabled
  the command-line extension on reload with `DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION`.
  Experiments changing profile preferences and extension loading did not establish
  a portable harness fix and were removed. The original bootstrap-retirement test
  remains unchanged; it does not prove functional control after extension reload.
- Final review correction verified: 108 isolated unit files, canonical four-package
  typecheck, six-package lint and documentation gates passed. Rebuilt-artifact
  Chrome smoke and diagnostic privacy suites passed 43 cases / 447 assertions.
  Focused Popup suites passed 23 cases / 75 assertions, including positive ready,
  wrong-session/duplicate ready, silent disposal beyond the deadline, shared causal
  failure identity and exactly-once failure presentation. Independent source
  re-review found no remaining blocker.
  Native Computer Use was stopped by its URL-identification policy; user feedback
  supplied the actual profile's recovery and speed-reset evidence.

Follow-up investigation within this workspace must exercise activation-blocked
`AudioContext.resume()` during initial Content policy and a non-responding existing
Offscreen HELLO. Both remain unbounded production dependencies, but neither was
established as the live incident's cause. Do not replace their physical completion
or write fences with a timeout that merely allows conflicting later writes.
