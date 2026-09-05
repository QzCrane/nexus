---
type: reference
status: archived
audience: developer
last_reviewed: 2026-08-27
---

# SPECTRA business, performance, and implementation audit — 2026-08-27

This report records a read-only audit of Git commit
`24fd7631e6417bfe6416745c2eefcc4b950656f4`. It is dated evidence, not a
replacement for the current [control architecture](../../control/README.md),
[runtime architecture](../../architecture/runtime.md),
[Media WebAudio admission owner](../../architecture/media-source-admission.md),
[protocol owner](../../reference/protocols.md), or
[Remote security owner](../../security/remote-control.md).

No runtime, test, configuration, release, branch, or external state was changed
by the audit. The unrelated untracked `halo-public-candidate-0.6.1/` directory
was protected and excluded.

## Evidence boundary

The tracked-path census covered 426 files: 359 SPECTRA application files, 23
contracts files, 16 audio-engine files, 17 kernel files, 7 Remote-site files,
and 4 SPECTRA repository gates. Six independent read-only reviews covered UI,
Background, Content, audio/Offscreen, Remote, and release/performance surfaces.
Every finding below was then checked against the current call chain and existing
tests; uncertain candidates are listed separately rather than promoted.

Executed evidence:

- Bun `1.3.14`;
- 588 unit, contract, and runtime tests passed across 77 files;
- the installed-Chromium smoke suite passed 40 of 41 scenarios; the only failure
  was the locale-dependent gate described as `GATE-001` below;
- SPECTRA dependency-closure typecheck, strict Biome, architecture verification,
  95-file documentation check, platform contract, governance tests, dependency
  advisory audit, public projection check, production build, and production
  artifact integrity passed;
- the production graph reported 66/66 artifacts reachable and no duplicate;
- the deployed Remote site matched the local bytes, MIME types, and security
  headers at `https://nexus-remote.pages.dev/`.

Passing evidence does not erase the races and missing negative cases below. In
particular, the Remote smoke transport is deterministic and does not prove live
PeerJS signaling recovery, and the audio tests do not prove EME/MSE/CORS behavior
in protected real-world players.

## Confirmed P1 findings

| ID | Finding and user-visible consequence | Root evidence |
| --- | --- | --- |
| `REM-001` | Remote reconnect resets sequence to zero in the Remote page and Offscreen host while a live Background worker retains the old value. Legitimate commands after reconnect are silently dropped until the counter catches up; after worker replacement the opposite reset can weaken the documented replay boundary. | `remote-site/app.js:142-149,180-193`; `src/offscreen-remote/remote-host.ts:203-208,241-249`; `src/background/remote-service.ts:90-106,323-339` |
| `REM-002` | A Remote command authorizes once, awaits Content runtime acquisition, and then executes using the stale authorization. Closing or replacing the session during that await can still execute the old command and can recreate or overwrite a released observation lease. | `src/background/remote-service.ts:116-136,258-273,323-369`; `src/background/runtime-loader.ts:377-447` |
| `AUD-001` | Offscreen Capture UPDATE writes the new processor generation before the audio graph/config transaction is acknowledged. If graph apply fails, Background retains the old generation while Offscreen advertises the new generation; the old STOP is then rejected and the processor/stream/lease can become a ghost owner. | `src/offscreen/audio-host.ts:178-190,489-514`; `src/background/handlers/capture.ts:478-501,557-599` |
| `AUD-002` | Media WebAudio admission treats a same-origin URL or same-origin `blob:` URL as sufficient safety evidence without checking `mediaKeys`, EME/protected state, or MSE segment provenance. A protected/opaque media element can enter an irreversible `MediaElementSourceNode` path and be reported active even when PCM is silent or unavailable. | `packages/features/audio-engine/src/webaudio/controller.ts:61-95`; `src/content/core/media-registry.ts:48-70`; `src/content/logic/mode-executor.ts:225-251` |
| `AUD-003` | Cross-origin admission reads the current `crossOrigin` value at metadata time but does not prove that the value was set before the current resource selection. Setting `src` first and `crossOrigin` later can mint false `preload-cors` evidence for an already no-CORS request. | `src/content/core/media-registry.ts:63-71,285-307,356-377`; `packages/features/audio-engine/src/webaudio/controller.ts:65-76` |
| `CON-001` | `MediaRegistry` registers initial media with an empty `documentId`; production initialization does not bind the document until a field-intent path reaches `NativeMediaExecutor`. A first marker/A-B/frame/screenshot operation or an early source-release event can therefore fail identity matching or emit an empty identity. | `src/content/core/media-registry.ts:97-104,191-198,259-274`; `src/content/core/index.ts:281-314`; `src/content/logic/control-operation-executor.ts:200-240`; `src/content/logic/native-media-executor.ts:720-728` |
| `CON-002` | Asynchronous media operations resolve a target once and do not revalidate `documentId + mediaId + sourceRevision` after awaits. If a page reuses the same element for a new source during frame measurement, seek, marker, or A/B work, the old command can mutate the new media and return an ACK for the old source. | `src/content/logic/native-media-executor.ts:725-769,866-897`; `src/content/video/time-marker.ts:115-138`; `src/content/video/ab-loop.ts:77-90,243-255` |
| `UI-001` | The Settings-view preset list initializes without a domain or apply handler but still renders Apply buttons and always emits an “Applied” toast. Clicking Apply performs no control operation and no site write, yet reports success. | `src/popup/views/settings.ts:40-70`; `src/popup/views/presets-ui.ts:38-52,181-194,306-319` |
| `UI-002` | The one-release v1 `UI_SYNC` adapter can overwrite a newer v2 `ControlSnapshot` using only `tabId`, without document/generation/revision fencing. The Popup can display stale config while retaining the newer revision and can save the stale values as a preset. | `src/popup/card/messaging.ts:23-102`; `src/popup/card/legacy-message-adapter.ts:16-51` |
| `CTL-001` | The final Capture mutation RPC accepts a no-tab extension sender carrying an arbitrary `tabId` and does not enforce the coordinator-issued `captureAdmission`. This leaves a second owner path around the current-foreground-document admission contract. | `src/background/handlers/capture.ts:604-645`; `src/background/control-coordinator.ts:2041-2083`; `src/content/logic/mode-executor.ts:90-107,236-253` |

## Confirmed P2 findings

### State, identity, and concurrency

- `CTL-002`: control commit and same-document history/hash invalidation use
  different per-tab async owners. A commit can pass its generation check, pause
  in persistence/publication, then publish an old generation after navigation
  has already carried state into a newer generation
  (`src/background/control-coordinator.ts:916-949,2189-2228,2411-2423`).
- `REM-003`: Remote commands are not serialized by session before their sequence
  gate. A later command can finish runtime acquisition first, advance
  `lastSequence`, and cause the earlier command to be discarded
  (`src/background/remote-service.ts:116-127,323-339`).
- `REM-004`: the Offscreen Peer host handles `open`, `connection`, and `error`,
  but not PeerJS `disconnected` or `close`. A signaling socket interruption can
  leave the advertised two-minute reconnect window unable to accept a new
  connection (`src/offscreen-remote/remote-host.ts:346-361`).
- `REM-005`: Remote-site challenge/proof handling checks an attempt only before
  entering an async Web Crypto operation. A stale connection's proof or auth
  result can mutate or terminate the current attempt after the await
  (`remote-site/app.js:64-152`).
- `AUD-004`: `WebAudioController.ensureAttached()` registers an irreversible
  source in ownership maps before `router.connectSource()` succeeds. A connect
  failure leaves a phantom binding; the existing-source retry path is outside
  the catch and can reject repeatedly (`packages/features/audio-engine/src/webaudio/controller.ts:185-219,232-243`).
- `CON-003`: source-change cleanup releases video effects only for DOM detach,
  not element reuse. CSS/filter/dim state can leak from an old source into a new
  source on the same `<video>` (`src/content/logic/native-media-executor.ts:1494-1520`;
  `src/content/video/video-effects-controller.ts:101-112`).
- `CON-004`: dim readback waits for an unbounded `requestAnimationFrame`. A
  hidden/frozen page can hold the operation RPC indefinitely; the promise has no
  timeout or lifecycle cancellation (`src/content/video/video-effects-controller.ts:123-141,236-274,530-539`).

### Popup and Options behavior

- `UI-003`: Popup audio failures update `state.lastError` and roll back but the
  renderer does not project that error to an accessible toast. Timer flushes and
  several event handlers explicitly discard the rejection
  (`src/popup/card/state.ts:114-207`; `src/popup/card/events.ts:129-188`;
  `src/popup/card/render.ts:20-119`).
- `UI-004`: Popup global-setting mutations are detached without a rejection
  handler. On storage/worker failure the checkbox/select remains optimistic and
  an unhandled rejection is possible (`src/popup/views/settings.ts:45-63,97-138`).
- `UI-005`: a received `spectra.settings.changed` event updates only a closure;
  it does not reapply theme, language, controls, cards, or side-panel projection
  in the already-open Popup (`src/popup/index.ts:58-70`;
  `src/popup/views/settings.ts:45-77`).
- `UI-006`: a coalesced effective-volume operation and ordinary DSP patch share
  one flush. If the volume stage fails, the already-consumed EQ/compressor/bass/
  mono patch is never sent or requeued (`src/popup/card/state.ts:118-207,248-285`).
- `UI-007`: side-panel audio state is not fully refreshed from each acknowledged
  snapshot. Stale full-array EQ state can overwrite newer changes made through
  the card or another control surface (`src/popup/side-panel/index.ts:89-103`;
  `src/popup/side-panel/controls.ts:159-177`;
  `src/popup/side-panel/registry.ts:1-30`).
- `UI-008`: closing and reopening the side panel on the same tab retains its old
  document/revision until an async snapshot arrives, while controls remain
  actionable (`src/popup/side-panel/index.ts:173-201`;
  `src/popup/side-panel/video-controls.ts:155-163`).
- `UI-009`: every side-panel open binds another one-shot `pagehide` listener;
  listeners accumulate until the Popup document closes
  (`src/popup/side-panel/index.ts:173-181`;
  `src/popup/side-panel/video-controls.ts:165-179`).
- `UI-010`: the side-panel speed UI clamps to `0.25`, while the canonical control
  range and main card allow `0.1`; valid `0.1–0.24x` values are inaccessible
  from this surface (`src/popup/side-panel/speed-controls.ts:29-68`;
  `packages/contracts/src/control.contracts.ts:1403`).
- `UI-011`: the side-panel control is labelled and exposed as “Toggle A/B loop”
  but always executes `ab-clear`; its toggle and accessibility semantics are
  false (`public/popup.html:489`; `src/popup/side-panel/video-controls.ts:230-246`).
- `UI-012`: Registry add/delete/read failures and side-panel Save Effects failure
  have no shared error surface; Save Effects can create an unhandled rejection
  (`src/popup/views/registry-ui.ts:112-170`;
  `src/popup/side-panel/footer-actions.ts:8-13,37-64`).
- `UI-013`: Options language mutation rolls the selector back but silently
  discards the failure instead of using the page's existing accessible error
  owner (`src/options/i18n.ts:20-35`; `src/options/status.ts:1-28`).

### Runtime and performance ownership

- `PERF-001`: a passive Popup `snapshot.get` performs two `actual.read` requests;
  those requests are classified as heavy-runtime-required and can inject, READY,
  and shortly release Content runtime merely to display state
  (`src/popup/card/init.ts:83-100`; `src/background/control-coordinator.ts:321-336`;
  `src/shared/content-runtime.ts:18-29`; `src/background/spectra-tab-client.ts:27-57`).
- `PERF-002`: background Popup cards initialize in an unbounded serial loop. One
  slow audible/recent tab blocks all later cards and startup cost grows linearly
  with visible-tab count (`src/popup/index.ts:117-159`).
- `PERF-003`: visualizer tab removal bypasses the normal reconciliation queue;
  an older async update can write a closed tab back into physical subscription
  bookkeeping (`src/background/handlers/audio.ts:118-177,322-346,480-489`).
- `PERF-004`: visualizer removal converts every transport exception to the same
  null value used for an idempotent missing receiver, then marks removal as
  accepted. A live Content analyser can survive without a retry
  (`src/background/handlers/audio.ts:139-173`).
- `PERF-005`: shortcut feedback uses one fixed runtime capability key with Set
  semantics. Concurrent feedback operations share a lease, so the first
  completion can release runtime while another feedback operation is still in
  flight (`src/background/shortcuts.ts:421-465`;
  `src/background/runtime-loader.ts:63-65,212-229`).
- `PERF-006`: each visualizer frame allocates a `Uint8Array`, converts it to a
  JavaScript array, then structured-clones it across contexts. The cost is
  bounded but scales linearly with active subscribed tabs and lacks a multi-tab
  CPU/GC benchmark (`packages/features/audio-engine/src/AudioGraphRouter.ts:252-256`;
  `src/offscreen/audio-host.ts:447-457`; `src/background/handlers/audio.ts:289-312`).

### Update, artifact, and release gates

- `UPD-001`: warm update queries only `http://` and `https://` tabs even though
  runtime admission and `<all_urls>` also support user-enabled `file://` tabs.
  Existing local-file pages retain old injected code until reload
  (`src/background/upgrade-manager.ts:45-63`;
  `src/background/runtime-loader.ts:107-114`).
- `GATE-001`: the installed-Chromium smoke test compares the localized display
  value from `chrome.commands.getAll()` with hard-coded English
  `Alt+Up Arrow`, while launch does not fix the browser language. It fails
  deterministically on the audited zh-CN host, which returned
  `Alt+向上箭头` (`test/smoke.spec.ts:2293-2302,2433-2442`).
- `GATE-002`: `test:chrome:dist` consumes whichever ignored `dist` is already on
  disk and does not bind it to current source, production marker, version, or an
  artifact receipt. The release orchestrator happens to build first, but the
  independently callable gate can certify stale output (`package.json:19-25`).
- `GATE-003`: artifact reachability treats arbitrary matching JavaScript string
  literals as loading edges. A dead string can make an orphan artifact appear
  reachable even though stricter static/deferred/runtime-loader edge parsers
  already exist in the same checker
  (`scripts/check-production-artifacts.ts:176-201,287-305,443-445`).
- `GATE-004`: the release workflow hashes the initial working tree and detects
  mutation during the run, but does not reject an initially dirty/untracked
  SPECTRA source tree or bind the package to an exact reviewed Git tree
  (`nexus/scripts/release-spectra.ts:111-140,217-254`).
- `GATE-005`: the public projection checker validates selected locale
  descriptions and a small set of English/Chinese store strings, but does not
  prove every store locale, privacy justification, manifest permission, network,
  and data-use projection (`nexus/scripts/check-public-projections.ts:43-75`).

## P3 implementation and capacity findings

- Current production closures pass their hard ceilings but have little growth
  margin: service-worker wake `250.2/256 KiB`, Popup static `142.3/144 KiB`, Popup
  eventual `147.8/152 KiB`, Content runtime eventual `168.6/176 KiB`, total JS
  `663.2/680 KiB`, and total dist `758.6/780 KiB`. The gate prevents an overage;
  it does not prove startup latency, parsing cost, CPU, GC, or IPC performance.
- The EQ curve attempts RGB string replacement to add alpha, but canonical colors
  are hex strings, so the intended gradient/shadow transparency is not applied
  (`src/popup/visualizer/draw-eq-curve.ts:88-96`).
- Site-hotkey list formatting duplicates the shared key formatter and exposes
  values such as `ArrowUp` where the editor shows `Up`
  (`src/options/site-editor.ts:225,259-266`; `src/options/formatters.ts:6-20`).
- `forEachBounded` uses `undefined` as both “no failure” and the rejection value;
  `Promise.reject(undefined)` resolves the aggregate as success
  (`src/background/bounded-fanout.ts:11-30`).

## Rejected or unresolved candidates

- Chrome documents tab IDs as unique within a browser session. A proposed
  same-session numeric tab-ID reuse race was therefore rejected rather than
  reported as a SPECTRA bug.
- A/B point A intentionally represents source-scoped state needed to set point B
  later. Its runtime ownership cannot be called a leak without a product decision
  to persist that state outside Content runtime.
- `srcObject`-only media currently has no Media WebAudio admission. This is a
  conservative boundary, not a bug, until an ownership/taint contract identifies
  a safe subset.
- Public PeerJS/STUN/TURN availability, protected commercial players, real audio
  hardware suspension, Chrome Web Store update propagation, and non-Windows
  keyboard behavior were not exercised. They remain explicit unknowns.

## Root repair order

1. Give Remote one session epoch/sequence/liveness owner and serialize command,
   reconnect, close, and observation acquisition through it.
2. Make Capture processor generation, graph, revision, snapshot, and lease one
   acknowledged transaction; enforce admission at the physical mutation owner.
3. Bind Content document identity at runtime creation and introduce one
   source-scoped cancellation/revalidation capability across every async media
   operation and source-change disposer.
4. Replace URL/current-property Media WebAudio admission with immutable
   resource-selection, CORS, MSE, EME, and protected-content evidence.
5. Make `ControlSnapshot` the only Popup projection, delete or strictly fence the
   legacy adapter, and route all UI mutations through one ACK/error/rollback
   owner shared by card, settings, registry, presets, and side panel.
6. Separate passive reads from runtime acquisition; then fix visualizer and
   shortcut lease queues and add multi-tab measurements.
7. Bind every release and Chrome smoke result to an exact production artifact
   and reviewed Git tree, with locale-independent browser assertions.

The repair order is architectural. This audit did not authorize or implement the
changes.
