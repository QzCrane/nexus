---
type: reference
status: stable
audience: developer
---

# 04b. Source Algorithms (§9 Audited source algorithms and dispositions)

> 主题 owner 段: §9 Audited source algorithms and dispositions
> 完整目录: [04-algorithm-matrix.md](04-algorithm-matrix.md) · [control-architecture.md](../control-architecture.md)

## §9 Audited source algorithms and dispositions

`CONTROL_ALGORITHM_POLICIES` in `packages/contracts/src/control.contracts.ts` is the executable form of the two matrices above. It is an exhaustive `Record<ControlCapability, ControlAlgorithmPolicy>` containing scope, algorithm kind, ordered strategies, ACK source, MAIN policy and recurring-work rule. `CapabilityPlanner` must consume that record instead of maintaining a second set of field lists. Adding a field or operation without a policy is a compile failure.

The following audit records the source present at the start of this redesign and
the landed disposition. Deleted locations are intentionally retained as
historical evidence and are labelled retired; normative current ownership lives
in the implementation-anchor tables above and below. Locations identify symbols
rather than relying only on line numbers, so the rationale remains useful as
files move.

### §9.1 Audio and processing algorithms

| Current source/symbol | Current algorithm | Decision and target algorithm |
| --- | --- | --- |
| retired `src/content/audio/dom-volume.ts::applyToElement`; retired mode-local native writers | Wrote both `volume` and `muted`, then could also write a site API and processor. | Replaced with one selected native writer. `volumeBase` writes only site API or `media.volume`; `mediaMuted` writes only site API or `media.muted`. `AudioProcessorConfig` has neither mute nor zero-gain admission: its only level field is `boostGain: 1–8`. |
| `src/popup/card/events.ts::handleVolume`; `hotkey-helpers.ts::sendVolumeAction/sendAudioAdjustment`; `remote-commands.ts::executeCommand` | Historically gave Popup, hotkeys and remote different native/Boost delta rules. | All surfaces now submit one typed `effective-volume 0–800` operation. Only the coordinator splits internal base/Boost writers; legacy gain/Boost actions are aliases. |
| `src/injector/webaudio-hijack.ts` | Replaces `AudioContext`, redirects `destination`, creates booster plus an implicit limiter and supports only volume for future contexts. | Remove from production. It cannot prove existing-context coverage or ACK mute/EQ/other DSP. Known official page-player objects use a capability adapter; opaque output uses Capture. No implicit limiter remains. |
| retired `packages/features/audio-engine/src/webaudio/node-factory.ts::createAudioGraph` | Created gain, Bass, compressor, analyser, ten EQ nodes, panner and delay for every media element, including neutral features. | Replaced by `AudioGraphRouter`: one document mix graph; one page-lifetime source per safe media; only non-neutral nodes exist. Neutral state is a transparent route with no DSP nodes. |
| `WebAudioController::attachNode` and retired `cors-checker.ts` | Previously set `crossOrigin` after source selection, irreversibly bound, then inferred CORS from analyser silence. | Current controller proves resource eligibility before `createMediaElementSource`. Same-origin or pre-load verified CORS may bind; unknown cross-origin goes directly to Capture. Silence is never a CORS test. |
| retired `content-bootstrap.js::installAudioMain`; retired `injector/dom-volume.ts` | Always-on `AudioContext` plus a hidden root-level capture even when no Boost/EQ/Visualizer was active. | Activation is now capability-driven: only the requested non-neutral DSP fields build nodes. Default page has no audio runtime; Capture is gated by `requestedCoverage:'full'` plus Capture lease. |
| `audio-engine::BoostEnvelope` (retired alias) | Treated Boost as a free-floating gain. | Replaced by `AudioProcessorConfig.boostGain` with one normalized processor readback and a `page-lifetime-after-media-binding` lifetime. |
| retired implicit limiter on main world Capture | Applied gain reduction implicitly when Capture activated. | Removed. Limiter is no product capability; it does not exist in the new `AudioProcessorConfig`. |
| `WebAudioController::updateProcessor` per-frame writes | Per-frame DSP writes and unconditional storage updates. | Latest-value coalescing, trailing storage write, and 0 Hz on neutral. IPC and storage only when actual changed. |

### §9.2 Media, video and timeline algorithms

| Current source/symbol | Current algorithm | Decision and target algorithm |
| --- | --- | --- |
| `media-control.ts::setSpeed/applySpeed`; `media-observer.ts` | Site API, isolated DOM, generic MAIN message and new-media observer can all write playback rate; preserve-pitch is echoed without durable state. | One writer: `playbackRate` first, with the implemented YouTube official API only after DOM failure; `preservesPitch` remains DOM-only. ACK follows the matching getter/event. New media restoration goes through the same executor and revision. |
| `time-marker.ts`, `ab-loop.ts` | A/B and marker jumps called `currentTime` directly with no mediaId/sourceRevision check. | A/B and markers are now keyed by `mediaId + sourceRevision`; their jumps go through the standard seek executor. Stale source identity is rejected before any page write. |
| `video-transform.ts::apply`, `video-filter.ts::apply` | Read inline `style.transform/filter`, replaced page values with extension values, never captured baseline. | Owners now read computed style for readback, capture the computed baseline at acquisition, and only override on top with extension attributes/variables. Disabling removes only owner state. |
| `dim-background.ts::apply` | Used inline `position:fixed` overlay that rewrote video `z-index`. | New overlay uses closed-shadow four-region geometry; never rewrites video `position`/`z-index`; target handoff releases the previous dim owner only and preserves independent CSS effects. |
| `pip-controller.ts::request`; `fullscreen-controller.ts::request` | Custom click prompt, persistence of `document.pictureInPictureElement` was by timer, listener could outlive click or runtime. | Standard API only, real user activation, `enter`/`leave` events, `pictureInPictureElement` getter. Popup PiP may inject one ISOLATED click after a native activation error, then defers to the same executor. No retention after click, timeout or runtime disposal. |
| `hotkey-helpers.ts::seekFrame` | Hard-coded `1/30s` and labelled frame step as exact. | Source-scoped cadence via `requestVideoFrameCallback` with bounded consecutive samples; mandatory `approximate:true`; paused uncached source is unsupported. |
| retired user-script facade without `userScripts` permission | Could run arbitrary page scripts. | Requires explicit `userScripts` permission, runs in isolated sandbox, never inherits site-adapter MAIN authority. |
| `media-observer.ts::onTimeUpdate` plus timer | Periodic IPC for active media. | Event-driven `seeked`/`playing`/capture token; latest-value coalescing, trailing storage write, no per-frame IPC. |

### §9.3 Entry, synchronization and site-adapter algorithms

| Current source/symbol | Current algorithm | Decision and target algorithm |
| --- | --- | --- |
| `content-bootstrap.js` plus `injector/main-runtime-manager.ts` (legacy) | Content bootstrap loaded a generic MAIN bundle; site adapters shared one main bundle. | Manifest content entry is `content-bootstrap.js` only. Each adapter is a one-shot, allowlisted setter/getter call dispatched by `main-runtime-manager.ts::applyMainSiteControl` from Background, capturing pre/post values without installing a bridge, wrapper, listener or descriptor patch. |
| `site-adapter.ts` (legacy) | Each adapter registered listeners and wrapper functions. | Adapters are no module; they are values in `SITE_NATIVE_EXECUTORS` consumed by `main-runtime-manager` with `satisfies Record<SiteNativeAdapterId, SerializedMainExecutor>`. |
| retired `document-observers/site-sync.ts` | Long-lived MutationObserver that wrote from page to extension. | Event-driven: per-frame `media-registry` events plus `webNavigation`; no permanent page observer; same-document navigation only advances `generation`. |
| `media-registry.ts::register` | Heuristic based on first `play` event; could latch on a wrong element. | Identity-bound Runtime ensure before any persistent action; selection criteria require user interaction or genuine page control; reused elements emit logical remove/register around `sourceRevision`. |
| `remote-commands.ts::executeCommand` | Sent `chrome.runtime.sendMessage` to itself with `action:'control.request'`, accepting its own response. | Background now calls the serialized coordinator directly: `submit`, `submitOperation`, `getSnapshot`. Remote no longer self-RPCs. |
| `remote-commands.ts::projectSnapshot` | Projected every actual field on every event, even those not authenticated to view. | Remote now projects only fields the device is allowed to see, retains same-document stable state on failure, and persists `sessionStorage`-backed `stableRemoteStates` keyed by `tabId`. |
| `control-coordinator.ts::applyPageObservation` | Routed page observations as a second content write, doubling IPC and risking echo. | Page observations commit without routing a second content write; `source:'system'` is preserved for downstream projections. |
| `control-coordinator.ts::applySiteNativeFallback` (legacy) | Restored site-native baselines on dispose, racing with the page's own restore. | Baselines are written through the same writer on restore; official reflected events are absorbed; DOM restore never competes. |
| `control-coordinator.ts::executeFieldOperation` | Partial ACK could return `ok`. | Every relevant field phase must be `applied` before operation success; per-field rollback on failure. |
| `media-observer.ts::tryAssignFromUser` | Inferred active media from `currentSrc` change. | Active media requires user interaction, page control, PiP owner, playback, or stable visibility; `currentSrc` change alone never advances selection. |
| `extension-settings::read` synchronous fallback | Read defaults from disk on every Popup open. | Background owns the read; settings repository is the only authority; extension reads cached snapshot only. |

### §9.4 Source algorithm adjudication catalog

| Source | Original algorithm | Decision | Augmentation admission | Interception policy | Recurring work |
| --- | --- | --- | --- | --- | --- |
| `src/content/audio/dom-volume.ts` (retired) | Mixed `volume` + `muted` writes | native-control | none | forbidden | none |
| `src/injector/webaudio-hijack.ts` (retired) | Hijack `AudioContext`, redispatch to `destination` | controlled-augmentation | none | forbidden | none |
| `packages/features/audio-engine/src/webaudio/node-factory.ts` (retired) | All-features graph per element | controlled-augmentation | proven-safe-source-or-explicit-full-output | forbidden | page-lifetime-after-media-binding |
| `src/injector/youtube-adapter.ts` | Allowlisted one-shot MAIN for speed/volume | hybrid-state-native | allowlisted-site-api-after-dom-failure | site-adapter-only | none |
| `src/background/main-runtime-manager.ts` | Multi-adapter dispatch | intent-routing | extension-owned | site-adapter-only | none |
| `src/content/audio/volume-observer.ts` | Reassert volume on `volumechange` | observation-only | not-applicable | forbidden | while-subscribed |
| `src/content/core/lifecycle/media-observer.ts` | Lifecycle: identity, source, generation | lifecycle-orchestration | extension-owned | forbidden | page-lifetime-after-media-binding |
| `src/content/logic/media-control.ts` | DOM audio property writes (volume, muted, rate, currentTime, loop) | native-control | none | forbidden | none |
| `src/content/video/ab-loop.ts`, `src/content/video/time-marker.ts` | Direct `currentTime` write | native-control | none | forbidden | while-owned |
| `src/content/video/video-filter.ts`, `src/content/video/video-transform.ts` | CSS Filter/transform composition | controlled-augmentation | extension-owned | forbidden | while-owned |
| `src/background/control-coordinator.ts` | Coordinator transaction over field/operation units | intent-routing | extension-owned | forbidden | none |
| `src/content/input/hotkey-helpers.ts` | Hotkey -> typed intent | intent-routing | extension-owned | forbidden | none |
| `src/content/logic/audio-runtime-control-delegate.ts` | Compile effective-volume 0–800 and DSP intents | controlled-augmentation | proven-safe-source-or-explicit-full-output | forbidden | while-owned |
| `packages/features/audio-engine/src/AudioGraphRouter.ts` | One shared media mix graph per document | controlled-augmentation | proven-safe-source-or-explicit-full-output | forbidden | page-lifetime-after-media-binding |
| `packages/features/audio-engine/src/CapabilityPlanner.ts` | Per-capability ordered strategy/admission | intent-routing | extension-owned | forbidden | none |
| `packages/contracts/src/control.contracts.ts` | Capability/operation/algorithm policy contracts | pure-computation | extension-owned | forbidden | none |

Capability policy answers what a user may control; the source algorithm catalog
answers how the implementation may calculate, route, observe or mutate it. The
executable owner is
`scripts/verify/spectra-control-algorithm-catalog.mjs`, deliberately outside all
extension bundles. `check-spectra-control.js` verifies every source/symbol
anchor, the decision/admission/lifetime vocabulary, sequential IDs and complete
coverage of all 51 capabilities. A source move, new algorithm or changed owner
therefore requires the catalog, this table and the implementation to change in
one release-gated commit.

The catalog boundary is every production unit reachable from a control surface
(page, Popup, authenticated remote, hotkey or Chrome lifecycle) that selects a
strategy, calculates a target/value, mutates native or extension state, observes
actual state, synchronizes a consumer, owns a lease/disposer, or gates a
privileged boundary. Small value-formatting helpers outside those paths are not
separate control algorithms. Under that definition the inventory contains 50
source algorithms, including the cross-cutting state, identity, observation,
handoff and bundle-admission algorithms that the earlier 34-row implementation
catalog did not name separately.

`pure-computation` and `intent-routing` have no page mutation authority.
`observation-only` may subscribe only to an existing native/owned source.
`native-control` may call only the named DOM/Chrome/official API.
`hybrid-state-native` may calculate or store a target, but the final page write
still uses the canonical native executor. `controlled-augmentation` and
`lifecycle-orchestration` may own only the explicitly named extension resource;
neither class admits a constructor/prototype/descriptor/createElement/History
or page-AudioContext interception. The one `site-adapter-only` entry is the
bounded official player call after a retryable DOM failure.

| Algorithm ID | Source algorithm | Decision | Native / controlled-augmentation judgment | Success and performance boundary |
| --- | --- | --- | --- | --- |
| `ALG-001` | Per-capability planner | pure computation | Selects only a capability-owned candidate; never executes or grants a fallback. | One bounded candidate pass per intent; coverage and admission are part of the result. |
| `ALG-002` | Cross-process ACK admission | pure computation | Rejects known strategy names when the exact field/operation does not admit them. | Constant policy lookup at every snapshot/apply/operation boundary. |
| `ALG-003` | Standard media writer/readback | native control | `HTMLMediaElement`/PiP/Fullscreen APIs only; native failure cannot become CSS/WebAudio/Capture/MAIN. | Temporary event/getter window on the same media/source; a matching getter without the required event is not an ACK; no retained work. |
| `ALG-004` | Allowlisted official player fallback | native control | One official YouTube API invocation only after retryable DOM failure; this is the sole MAIN write admission. A separate MAIN-world bridge (`content-youtube-volume-bridge.js`, YouTube-scoped, V1-guarded) reads `#movie_player.getVolume()` and syncs it to a data attribute so the ISOLATED-world `volumeBase` reader reflects the user-facing slider instead of YouTube's non-linear `element.volume` curve. | Write invocation reads official before/actual values and leaves no bridge/listener; the read bridge is a passive attribute sync with no page mutation authority. |
| `ALG-005` | Chrome tab mute/pin | native control | Chrome `tabs.update` plus browser getter/event only. | One write/get pair; later synchronization reuses Chrome events. |
| `ALG-006` | Audio session gate | lifecycle orchestration | Extension state may acquire/release an admitted processor, but cannot write native media fields. | Neutral configuration allocates nothing; dependent actual/error fields prove startup. |
| `ALG-007` | Processor-needs predicate | pure computation | Boost/EQ/Bass/Compressor/Mono/Pan/Delay share one predicate; Visualizer is excluded. | Constant bounded config scan; Policy and UI prediction cannot drift. |
| `ALG-008` | DSP mode selection | lifecycle orchestration | Transparent bypass first, safe complete Media WebAudio second, authorized full-output Capture last. | Stateless selection; processor allocation follows only after admission. |
| `ALG-009` | Prospective media eligibility | pure computation | Same-origin/origin-owned/preloaded-CORS evidence only; no binding or silence probe. | One registry-sized pass before any irreversible source creation. |
| `ALG-010` | MediaElementSource singleton | controlled augmentation | Safe media graph only; no generic page AudioContext interception. | WeakMap gives one source per element; the minimal route lasts only to navigation after first bind. |
| `ALG-011` | Sparse shared DSP topology | controlled augmentation | Adds only explicitly enabled Web Audio nodes to an admitted processor. | Snapshot reports normalized config/signature/source count; neutral lane has no DSP nodes. |
| `ALG-012` | Latest DSP apply/crossfade | controlled augmentation | Parameter changes reuse nodes; topology changes build one gated candidate. | One active plus one latest pending apply; Boost/EQ/Pan/Delay ramp in place. |
| `ALG-013` | Capture processor handoff | controlled augmentation | Full-tab Capture only for explicit full/opaque scope; never a target/native-field fallback. | Candidate is running/read back behind zero gain before atomic gate switch; previous stable processor survives failure. |
| `ALG-014` | Capture Visualizer sampling | observation only | Analyser may attach only to an existing processor. | One analyser per processor, cached at no more than 15 Hz while subscribed. |
| `ALG-015` | Media identity/target selection | observation only | Native DOM/events provide identities and facts; no page write or scan-based pseudo-control. | Mutation/Intersection/native events only; sticky target scoring uses cached data. |
| `ALG-016` | Page-native synchronization | observation only | Genuine page events commit actual state directly; reflected extension events are absorbed. | Reuses registry events and the loop attribute observer; fullscreen has no second lifecycle `applyState`, polling or descriptor patch. |
| `ALG-017` | Frame cadence and step | hybrid state/native | Extension estimates a bounded median delta; canonical native seek is the only writer. | At most eight rVFC samples/750ms, source-revision cache, result always marked approximate. |
| `ALG-018` | Rotation/mirror/fill | controlled augmentation | Owned individual CSS `rotate`/`scale`/`object-fit`; never replaces site `transform`. | Owner plus computed-style readback; ResizeObserver only for an owned 90/270-degree rotation. |
| `ALG-019` | Video filter composition | controlled augmentation | Captures current computed filter, composes owned functions and removes ownership on disable. | Computed-filter readback; no observer, inline replacement or MAIN style patch. |
| `ALG-020` | Dim overlay geometry | controlled augmentation | Closed-shadow four-region overlay; never rewrites target layout/z-index or releases another effect when the dim target changes. | One coalesced rAF on resize/scroll only while enabled, with geometry/opacity readback and per-effect owner release. |
| `ALG-021` | A/B scheduler | hybrid state/native | Source-keyed points and scheduling are extension-owned; boundary jump uses canonical seek. | One timer plus near-boundary rVFC only for a complete playing loop; all disposed on release. |
| `ALG-022` | Time marker index/jump | hybrid state/native | Marker metadata is extension-owned; every jump remains native seek. | 1,000-marker/source bound and binary lookup; no recurring work. |
| `ALG-023` | Screenshot verify/crop/save | native control | Chrome visible-tab capture is the only frame acquisition; no media canvas/CORS/DRM workaround. | Target/geometry verified twice and download must reach complete; no image IPC. |
| `ALG-024` | Page settings release | lifecycle orchestration | Restores only baselines SPECTRA actually owns and defers official fields to their adapter. | Explicit registry-sized pass with per-field readback/rollback; no retained work. |
| `ALG-025` | Compound reset/toggle transaction | lifecycle orchestration | Expands into typed field algorithms; cannot bypass per-field strategy. | Serialized per tab; every field applies before commit and compensation preserves the previous stable snapshot. |
| `ALG-026` | Info OSD projection | observation only | Reads media/snapshot facts and writes extension UI only. | One projection per action; acquires no processing or writer lease. |
| `ALG-027` | Popup/options/URL browser actions | native control | Chrome UI/navigation APIs only; URL remains HTTP(S)-validated. | One browser result per explicit operation; no content emulation. |
| `ALG-028` | userScripts execution | controlled augmentation | Explicit permission and isolated userScripts sandbox only; no shared site-adapter MAIN authority. | Bounded script/tab validation and one sandbox result; no recurring work. |
| `ALG-029` | Hotkey normalization | intent routing | Key handlers only build canonical intents; they never become another writer. | Compiled O(1) key map and one configured-site listener; descriptor owns repeat/coalescing/activation rules. |
| `ALG-030` | Popup latest-value patching | intent routing | Optimistic presentation has no authority; coordinator actual ACK replaces it. | Continuous sends cap at 20 Hz, identical values are dropped before IPC, and storage trails at 250ms with flush. |
| `ALG-031` | Remote command routing | intent routing | Authenticated commands use the same coordinator and cannot choose strategy or tab fallback. | Event-driven actual snapshot push; no post-command multi-source polling. |
| `ALG-032` | Remote authentication/replay boundary | lifecycle orchestration | HMAC/sequence/generation/fixed-tab gate precedes all state and command traffic. | One authenticated controller; only bounded pairing/reconnect timers. |
| `ALG-033` | Offscreen host lease lifecycle | lifecycle orchestration | One extension-owned offscreen document for audio and remote; modules cannot close it directly. | Serialized creation/handshake/recovery; closes 30s after final lease release. |
| `ALG-034` | Popup Visualizer scheduler | observation only | Visible subscribed cards read one existing processor batch; no processing acquisition. | One rAF scheduler and one in-flight IPC batch; stops immediately when hidden/unsubscribed. |
| `ALG-035` | Authoritative per-tab control transaction | lifecycle orchestration | Serializes every surface into one actual snapshot commit; no caller becomes a second state owner. | One bounded queue task per intent/event, one revision commit, no polling. |
| `ALG-036` | Document generation and target invalidation | observation only | Navigation and typed target/source events invalidate identity; they never emulate control. | Event-driven generation/identity update; stale intent/ACK cannot commit. |
| `ALG-037` | Multi-consumer Content runtime lease | lifecycle orchestration | Loads only the isolated runtime owned by explicit control/restore/hotkey/observation/source tokens. | READY handshake, one runtime/document, final-token disposer; default bootstrap remains minimal. |
| `ALG-038` | Native baseline ownership and warm handoff | lifecycle orchestration | A page-lifetime WeakMap remembers only SPECTRA-owned native fields; no setter/descriptor interception. | Restore is O(owned fields) and writes only when current actual still equals the last SPECTRA ACK. |
| `ALG-039` | Trusted activation native fast path | native control | Page keydown executes play/PiP/fullscreen directly. Popup PiP uses one immediate ISOLATED-world execution that synchronously enters the lifecycle-bound Content trigger and the same native writer while Chrome still reports active user activation. | One native call plus bounded event/getter ACK; no second prompt, MAIN script, polling or activation synthesis. The trigger exists only with the Content observation lease and ignores calls without live user activation. |
| `ALG-040` | Cross-mode WebAudio/Capture handoff | lifecycle orchestration | Old DSP becomes unity, candidate actual is verified, then the retired lease is released or restored. | One serialized transition, no full-gain overlap, duplicate source or stale commit. |
| `ALG-041` | Popup live observation lease | lifecycle orchestration | Foreground Popup acquires event observation only; no MAIN/audio/Capture authority. | One token/card while visible, released on pagehide; page changes push without polling. |
| `ALG-042` | Single UI actual projection with dual clocks | observation only | `ControlSnapshot` owns fields; the independent audio clock owns processor lifecycle only. | One accepted event/render per domain revision; no cross-domain max-generation suppression. |
| `ALG-043` | Authenticated remote observation lease | lifecycle orchestration | Only the fixed authenticated tab/session can retain page observation and receive state. | Event-driven snapshot push for one controller; released on close/replacement/reconnect expiry. |
| `ALG-044` | Multi-consumer Visualizer subscriber registry | observation only | Subscriber token/generation union observes only existing processors; no consumer can release another. | Bounded lease map and tombstones; final release removes analyser work and periodic IPC. |
| `ALG-045` | Configured-site hotkey runtime admission | lifecycle orchestration | A normalized host with an enabled handled binding may own one listener runtime; other sites remain bootstrap-only. | O(1) chord lookup; no default-site listener or command-time binding scan. |
| `ALG-046` | Source-scoped Marker/A-B runtime ownership | lifecycle orchestration | Source-keyed extension state retains runtime without changing the native writer boundary. | One token/source feature; source removal/final clear releases all work and survives worker restart reconciliation. |
| `ALG-047` | Lazy video enhancement module admission | lifecycle orchestration | Video CSS/overlay implementation loads only after an explicit non-native enhancement intent. | Native-only/default pages omit the module; neutral reads/writes remain DOM-free. |
| `ALG-048` | Extension-UI protocol allowlist | pure computation | Popup/remote can send only the 23 exported request types and accept only six events; Options is further restricted to ten settings/registry requests and one settings event. Both successful and failed responses reject non-surface types. | Canonical focused validators own nested semantics and mutation parity tests prevent lightweight wire-shape drift; Options never loads control/audio/remote validators and privileged router code stays out of every UI bundle. |
| `ALG-049` | Popup atomic Filter latest-value transport | intent routing | Filter value and its ownership bit are one typed intent; the UI merges only the coordinator's actual ACK and never predicts a partial filter state. | One request in flight plus one latest pending value, capped at 20 sends/second; no per-slider IPC stream. |
| `ALG-050` | Atomic effective-volume transaction | hybrid native/controlled augmentation | One public `0–800` value uses native base first and hidden processor Boost only above 100; only actual Capture active may color it purple. | Same-region writes touch one owner, threshold crossings compensate both, and an identical actual value produces zero Content IPC/revision/storage work. |

The catalog is the contract surface used by `check-spectra-control.js` to confirm that every algorithm row is present in the matrices above, every source anchor still resolves, and the cross-reference between `CONTROL_ALGORITHM_POLICIES`, the mirror and this section does not drift.
