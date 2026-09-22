---
type: reference
status: stable
audience: developer
last_reviewed: 2026-08-28
---

# 04b. Source Algorithms (§9 Audited source algorithms and dispositions)

> 主题 owner 段: §9 Audited source algorithms and dispositions
> 完整目录: [04-algorithm-matrix.md](04-algorithm-matrix.md)

## §9 Audited source algorithms and dispositions

`CONTROL_ALGORITHM_POLICIES` (`packages/contracts/src/control.contracts.ts`) executable `Record<ControlCapability, ControlAlgorithmPolicy>` owns scope, kind, strategies, ACK source, MAIN policy, and work rules. Processor fields share one ordered strategy: proven `media-webaudio`, then admitted `capture`. Missing policies cause compile errors.

This audit records legacy source dispositions. Retired locations are historical evidence; current ownership uses implementation anchors.

### §9.0 Retired/forbidden processor and route inventory

Names and paths in the negative rows below are forbidden production owners. They are retained only to make source-deletion and import-deletion checks reviewable; no row grants them runtime authority.

### §9.1 Audio and processing algorithms

| Current source/symbol | Current algorithm | Decision and target algorithm |
| --- | --- | --- |
| retired `dom-volume.ts::applyToElement`; retired local native writers | Wrote `volume` and `muted`. | Replaced with one selected native writer: `volumeBase` writes `media.volume`, `mediaMuted` writes `media.muted`. `AudioProcessorConfig` lacks mute/zero-gain admission. |
| `popup/card/events.ts::handleVolume`; `hotkey-helpers.ts`; `remote-commands.ts` | Separate native/Boost delta rules. | All surfaces submit typed `effective-volume 0–800`. Coordinator splits internal base/Boost writers. |
| retired/forbidden `webaudio-hijack.ts` | Replaced `AudioContext`, redirected `destination`, and applied limits. | Removed from production; processing uses only the proven MediaElement WebAudio owner or admitted Capture owner. No implicit limiter. |
| retired/forbidden `audio-engine/src/webaudio/node-factory.ts::createAudioGraph` | Created all nodes per media. | Removed; `offscreen/audio-host.ts` owns one tab Capture graph with non-neutral nodes only. |
| retired/forbidden `WebAudioController::attachNode` and `cors-checker.ts` | Late `crossOrigin` set and inferred CORS from silence. | Removed; the MediaElement WebAudio owner requires proven source eligibility before binding, without inferring CORS from silence. |
| retired/forbidden `content-bootstrap.js::installAudioMain`; retired `dom-volume.ts` | Always-on `AudioContext` or Capture. | Capability-driven: non-neutral DSP fields request a processor; complete safe media coverage admits MediaElement WebAudio, otherwise Capture still requires `requestedCoverage:'full'` plus an invocation admission. |
| `audio-engine::BoostEnvelope` (retired) | Free-floating gain. | Replaced by `AudioProcessorConfig.boostGain` readback. |
| retired implicit limiter | Applied gain reduction on Capture. | Removed; no product capability. |
| retired/forbidden `WebAudioController::updateProcessor` | Per-frame writes. | Capture host uses latest-value coalescing, trailing storage write, 0 Hz on neutral. |

### §9.2 Media, video and timeline algorithms

| Current source/symbol | Current algorithm | Decision and target algorithm |
| --- | --- | --- |
| retired `media-control.ts`; retired `media-observer.ts` | Multiple writers for rate. | One writer: `playbackRate` only. Restoration uses same executor. |
| `time-marker.ts`, `ab-loop.ts` | Direct `currentTime` without identity check. | Keyed by `mediaId + sourceRevision`; jumps use standard seek executor. |
| `video-transform.ts`, `video-filter.ts` | Replaced page values with extension values. | Read computed style, capture baseline, override. Disabling removes owner state only. |
| `dim-background.ts` | Fixed overlay rewriting video `z-index`. | Closed-shadow four-region geometry; never rewrites target position/z-index. |
| `pip-controller.ts`; `fullscreen-controller.ts` | Custom click prompt, timer persistence. | Standard API, real activation. Popup PiP uses immediate ISOLATED-world execution. No retention. |
| `hotkey-helpers.ts::seekFrame` | Hard-coded `1/30s`. | Source-scoped cadence via `requestVideoFrameCallback`; mandatory `approximate:true`. |
| retired user-script facade | Ran arbitrary scripts without permission. | Requires `userScripts` permission, isolated sandbox. |
| retired `media-observer.ts::onTimeUpdate` | Periodic IPC. | Event-driven coalescing, no per-frame IPC. |

### §9.3 Entry, synchronization and runtime algorithms

| Current source/symbol | Current algorithm | Decision and target algorithm |
| --- | --- | --- |
| `content-bootstrap.js` + `main-runtime-manager.ts` (legacy) | Generic MAIN bundle dispatch. | Minimal ISOLATED bootstrap plus guarded MAIN artifacts. No generic dispatcher. |
| legacy hostname dispatch module | Registered listeners per domain. | Removed. Volume/mute/speed uses exact media element capability discovery. |
| retired `document-observers/site-sync.ts` | Long-lived MutationObserver. | Event-driven `media-registry` and `webNavigation`; no permanent page observer. |
| `media-registry.ts::register` | First `play` event heuristic. | Identity-bound Runtime ensure before persistent action. Requires user interaction or page control. |
| `remote-commands.ts::executeCommand` | Self-RPC via `sendMessage`. | Calls serialized coordinator directly (`submit`, `getSnapshot`). |
| `remote-commands.ts::projectSnapshot` | Projected all fields on every event. | Projects only authorized fields; persists `stableRemoteStates`. |
| `control-coordinator.ts::applyPageObservation` | Routed observation as second content write. | Commits directly; `source:'system'` preserved. |
| retired adapter-fallback path | Restored baselines on dispose. | Removed; Restore writes only SPECTRA-owned fields. |
| `control-coordinator.ts::executeFieldOperation` | Partial ACK could return `ok`. | All phases must be `applied`; per-field rollback on failure. |
| retired/forbidden `media-observer.ts::tryAssignFromUser` | Inferred active media from `currentSrc`. | Removed; active-media ownership comes from the event-driven registry and explicit identity-bound runtime admission. |
| `extension-settings::read` | Synchronous disk read. | Background owns read; extension reads cached snapshot. |

### §9.4 Retired/forbidden source inventory and current anchors

| Source | Original algorithm | Decision | Augmentation admission | Interception policy | Recurring work |
| --- | --- | --- | --- | --- | --- |
| `src/content/audio/dom-volume.ts` (retired/forbidden) | Mixed writes | native-control | none | forbidden | none |
| `src/injector/webaudio-hijack.ts` (retired/forbidden) | Hijack `AudioContext` | controlled-augmentation | none | forbidden | none |
| `audio-engine/src/webaudio/node-factory.ts` (retired/forbidden) | Per-element graph | controlled-augmentation | none | forbidden | none |
| `src/injector/youtube-adapter.ts` (retired/forbidden) | Allowlisted MAIN | hybrid-state-native | none | forbidden | none |
| `src/background/main-runtime-manager.ts` | Versioned bridge | intent-routing | extension-owned | forbidden | none |
| `src/content/injector/page-media-bridge.ts` | Exact-element controller | native-control | none | forbidden | none |
| `src/content/audio/volume-observer.ts` (retired/forbidden) | Reassert on `volumechange`| observation-only | not-applicable | forbidden | while-subscribed |
| `src/content/core/lifecycle/media-observer.ts` (retired/forbidden) | Lifecycle observation | lifecycle-orchestration| none | forbidden | none |
| `src/content/logic/media-control.ts` (retired/forbidden) | DOM audio writes | native-control | none | forbidden | none |
| `src/content/video/ab-loop.ts`, `time-marker.ts`| `currentTime` write | native-control | none | forbidden | while-owned |
| `src/content/video/video-transform.ts` | CSS composition | controlled-augmentation | extension-owned | forbidden | while-owned |
| `src/background/control-coordinator.ts` | Coordinator transaction | intent-routing | extension-owned | forbidden | none |
| `src/content/input/hotkey-helpers.ts` | Hotkey -> typed intent | intent-routing | extension-owned | forbidden | none |
| `src/content/logic/audio-runtime-control.ts` | Compile intents | controlled-augmentation | extension-owned | forbidden | while-owned |
| `packages/features/audio-engine/src/WebAudioController.ts` | proven MediaElement graph | controlled-augmentation | extension-owned | forbidden | while-owned |
| `src/offscreen/audio-host.ts` | full-tab Capture graph | controlled-augmentation | extension-owned | forbidden | while-owned |
| `contracts/src/control.contracts.ts` | Policy contracts | pure-computation | extension-owned | forbidden | none |

The catalog defines exactly what executable code fulfills a capability. Verification script `check-spectra-control.ts` confirms every anchor and sequential IDs `ALG-001` through `ALG-050`.

| ID | Source algorithm | Decision | Native/augmentation judgment | Success and performance boundary |
| --- | --- | --- | --- | --- |
| `ALG-001` | Canonical processor-needs predicate | pure-computation | Non-neutral DSP only; native fields stay outside the predicate. | One bounded config scan. |
| `ALG-002` | Cross-process ACK | pure-computation | Rejects invalid strategies. | Constant policy lookup. |
| `ALG-003` | Standard media writer | native-control | Native APIs only. | Temporary event/getter window. |
| `ALG-004` | Tab mute/pin | native-control | Chrome `tabs.update`. | One write/get pair. |
| `ALG-005` | Audio session gate | lifecycle-orchestration| Ext state acquires processor. | Dependent fields prove startup. |
| `ALG-006` | Three-owner mode classification | pure-computation | Neutral demand maps to bypass; complete proven media coverage maps to WebAudio; otherwise Capture. | One config scan plus registry-sized coverage proof. |
| `ALG-007` | Processor admission and mode transition | lifecycle-orchestration| Exact source evidence for WebAudio; current one-shot extension admission for Capture. | One serialized transition. |
| `ALG-008` | Document-bound Capture admission identity | pure-computation | Operation, document, worker epoch, expiry, and one-shot fence. | Constant bounded-table validation. |
| `ALG-009` | Capture ACK normalization | lifecycle-orchestration| Exact generation/revision/running/signature/readback before snapshot commit. | One ACK commit; stale identity discarded. |
| `ALG-010` | Sparse Capture DSP topology | controlled-augmentation| Enabled nodes only in the offscreen graph. | Snapshot reports normalized config and signature. |
| `ALG-011` | Capture DSP apply/crossfade | controlled-augmentation| Reuse nodes; crossfade on change. | One active + one pending apply. |
| `ALG-012` | Processor handoff | controlled-augmentation| Full requested audio scope, exact WebAudio coverage or explicit Capture admission. | Candidate readback precedes switch; failure restores acknowledged owner. |
| `ALG-013` | Visualizer sampling | observation-only | Analyser on acknowledged MediaElement WebAudio first, Capture only as coverage fallback. | One analyser; cached 15 Hz limit while subscribed. |
| `ALG-014` | Target selection | observation-only | DOM/events provide facts. | Sticky scoring uses cached data. |
| `ALG-015` | Native sync | observation-only | Genuine events commit directly. | Reuses registry events. |
| `ALG-016` | Frame cadence | hybrid-state-native | Bounded median delta -> seek. | Max 8 samples/750ms; approximate. |
| `ALG-017` | CSS Enhancement | controlled-augmentation| Owned `rotate`/`scale`/`object-fit`. | Computed-style readback. |
| `ALG-018` | Filter composition | controlled-augmentation| Composes owned functions. | Computed-filter readback. |
| `ALG-019` | Dim overlay | controlled-augmentation| Closed-shadow overlay. | One coalesced rAF on resize. |
| `ALG-020` | A/B scheduler | hybrid-state-native | Owned scheduling -> native seek. | One timer + near-boundary rVFC. |
| `ALG-021` | Marker jump | hybrid-state-native | Extension metadata -> native seek. | 1000-marker limit; binary lookup. |
| `ALG-022` | Screenshot verify | native-control | Chrome tab capture only. | Target verified twice; no image IPC. |
| `ALG-023` | Page settings release| lifecycle-orchestration| Restores SPECTRA-owned baselines. | Explicit registry-sized pass. |
| `ALG-024` | Reset/toggle txn | lifecycle-orchestration| Serialized per tab per-field. | Reverts to stable snapshot on failure. |
| `ALG-025` | Info OSD | observation-only | Writes UI only. | One projection per action. |
| `ALG-026` | Browser actions | native-control | Chrome UI/nav APIs only. | One browser result per action. |
| `ALG-027` | userScripts execution| controlled-augmentation| Explicit sandbox only. | Bounded script validation. |
| `ALG-028` | Hotkey normalization | intent-routing | Builds canonical intents. | Compiled O(1) key map. |
| `ALG-029` | Popup latest-value | intent-routing | One private typed Popup control channel publishes the latest continuous volume/DSP value to a Background-owned slot; only the existing coordinator mutates control state and its ACK replaces optimistic UI. | Per target/field latest slot, 50 ms coalesce, identical values dropped; Popup disconnect retires only its response channel. |
| `ALG-030` | Remote command route | intent-routing | Authenticated coordinator use. | Event-driven snapshot push. |
| `ALG-031` | Remote auth boundary | lifecycle-orchestration| HMAC/sequence gate. | One authenticated controller. |
| `ALG-032` | Offscreen host lease | lifecycle-orchestration| One document for audio/remote. | Serialized creation; 30s final close. |
| `ALG-033` | Visualizer scheduler | observation-only | One batch marks only the visible foreground card as a processor-source candidate; background cards stay passive. | One rAF/in-flight batch; bounded failure backoff; hidden/disabled release. |
| `ALG-034` | Per-tab txn | lifecycle-orchestration| Serializes into one snapshot. | One queue task per intent. |
| `ALG-035` | Target invalidation | observation-only | Nav/events invalidate identity. | Event-driven update. |
| `ALG-036` | Content runtime lease| lifecycle-orchestration| Loads isolated runtime. | Final-token disposer; reject late completion. |
| `ALG-037` | Baseline warm handoff| lifecycle-orchestration| Remembers owned native fields. | Restore is O(owned). |
| `ALG-038` | Native fast path | native-control | Direct play/PiP/fullscreen on activation. | One native call, no polling. |
| `ALG-039` | Three-owner DSP handoff | lifecycle-orchestration| Verified MediaElement WebAudio/Capture candidate actual before switch. | Serialized transition with compensation. |
| `ALG-040` | Popup observation | lifecycle-orchestration| One background-minted document token per admitted foreground card port. | Browser port disconnect releases the token, including late acquisition; 15s acquisition deadline. |
| `ALG-041` | UI actual projection | observation-only | `ControlSnapshot` owns fields. | One render per domain revision. |
| `ALG-042` | Remote observation | lifecycle-orchestration| Fixed tab observation. | Event-driven snapshot push. |
| `ALG-043` | Visualizer source reconciliation | lifecycle-orchestration | Trusted Popup + active exact document; Content owns subscriber tokens and Background admits Capture only if page coverage fails. | Bounded lease/tombstone map and bounded release retry; final subscriber retires transient work. |
| `ALG-044` | Hotkey runtime | lifecycle-orchestration| One listener runtime per handled site. | O(1) chord lookup. |
| `ALG-045` | Marker/A-B runtime | lifecycle-orchestration| Source-keyed state retains runtime. | Survives worker restart. |
| `ALG-046` | Video enhancement | lifecycle-orchestration| Loads explicitly. | Neutral reads DOM-free. |
| `ALG-047` | UI protocol allowlist| pure-computation | Exported request types only, including hotkey-target settings requests. | Canonical validators; no wire drift. |
| `ALG-048` | Filter transport | intent-routing | Filter value and ownership bit. | 20 Hz cap; no partial UI prediction. |
| `ALG-049` | Effective-vol txn | hybrid-state-native | Exact page controller first for `0–800`; DOM `0–100`; proven MediaElement WebAudio Boost after above-100 native rejection; Capture only for incomplete/unsafe coverage. | Zero IPC for identical actual values, zero audio runtime for an acknowledged page-native value, and no unnecessary Capture acquisition on safe media. |
| `ALG-050` | Page-media bridge | native-control | Synchronous exact-element discovery. | Scans <= 12 ancestors, no retained loop. |
