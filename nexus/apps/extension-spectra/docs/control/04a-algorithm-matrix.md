---
type: reference
status: stable
audience: developer
---

# 04a. Algorithm Matrix (§8 Complete control algorithm matrix)

> 主题 owner 段: §8 Complete control algorithm matrix
> 完整目录: [04-algorithm-matrix.md](04-algorithm-matrix.md) · [control-architecture.md](../control-architecture.md)

## §8 Complete control algorithm matrix

This matrix is exhaustive for the persisted fields and momentary operations exported by `control.contracts.ts`. Adding a UI button, hotkey, remote command or protocol action without first adding or mapping an entry here is an architecture violation.

### §8.1 Persistent and observable fields

| Capability | Required scope | Selection order | Acknowledgement and fallback |
| --- | --- | --- | --- |
| Audio enabled | document | coordinator state expansion | Expands to per-field acquire/release intents; it is never a page-wide processing mode. |
| Internal native component `volumeBase 0–100` | target or all requested media | `HTMLMediaElement.volume` -> allowlisted official getter/setter only after proven DOM write/readback or coverage failure | DOM uses `volumechange` plus getter; the one-shot official path uses a bounded quiet window plus stable getter. A genuine page gesture also neutralizes a stale hidden Boost in the same commit. Capture is never this field's writer. |
| Internal processor component `boost 1–8x` | explicit full audio output | safe shared Media WebAudio -> Capture | Gain-node/processor readback; native volume is never raised above 100%. This field has no independent UI and target-only requests fail rather than widening to the tab. |
| Media mute | target or all requested media | `HTMLMediaElement.muted` -> allowlisted official API only after proven DOM write/readback or coverage failure | DOM uses `volumechange`; the official path uses a bounded quiet window plus stable getter. Numeric volume is preserved and Capture is never this field's writer. |
| Tab mute | tab | `chrome.tabs.update({muted})` | `tabs.onUpdated`/`tabs.get` readback; never aliases media mute. |
| Playback speed | active target | `playbackRate` -> site API when DOM coverage is incomplete | DOM uses `ratechange` plus getter; the one-shot official path uses a bounded quiet window plus stable getter and installs no persistent MAIN interception. |
| Preserve pitch | active target | standard `preservesPitch` property only | Property/getter readback; unsupported when the property is absent. |
| Playing | active target | awaited standard `play()`/`pause()` only | `playing`/`pause` event; autoplay rejection is returned, not bypassed. |
| Current time | active target | seekable standard media timeline only | Clamp to `TimeRanges`; acknowledge `seeked` and getter, never setter return. |
| Whole-media loop | active target | standard `HTMLMediaElement.loop` only | Getter/readback; does not share state with A/B. |
| Picture-in-Picture | active video | standard Picture-in-Picture API only | A Popup click immediately runs one `scripting.executeScript` in the extension ISOLATED world and synchronously dispatches the lifecycle-bound Content trigger. Content admits it only while `navigator.userActivation.isActive`, then calls the same `NativeMediaExecutor`. Success requires the native enter/leave event and `pictureInPictureElement`; there is no second prompt, MAIN script, synthetic activation or Capture fallback. |
| Fullscreen | active video | standard Fullscreen API only | `fullscreenchange` and `fullscreenElement`; no synthetic gesture or site-adapter claim. |
| Rotation | active video | extension CSS individual `rotate` | Computed-style readback; remove only extension owner state. |
| Mirror | active video | extension CSS individual `scale` | Computed-style readback; never overwrite the site's `transform`. |
| Fill/crop | active video | extension `object-fit:cover` owner rule | Computed `object-fit`; disabling removes the owner attribute. |
| Filter enabled/values | active video | extension CSS filter composition | Computed-style readback; compose without replacing source inline style. |
| Dim enabled/opacity | active video | extension closed-shadow four-region overlay | Overlay geometry/opacity readback; never rewrite video position or z-index, and switching the dim target preserves every independent effect still owned on the previous video. |
| A/B state | `mediaId + sourceRevision` | extension state + native seek executor | Points validate `0 <= A < B`; boundary seek ACK updates the same target only. |
| Tab pinned | tab | `chrome.tabs.update({pinned})` | `tabs.onUpdated`/`tabs.get` readback. |
| EQ / Bass / Compressor / Mono / Pan / Delay | explicit full audio output | safe shared Media WebAudio -> Capture | Processor parameter/topology readback; Capture is the only opaque full-output fallback and target-only requests fail before activation. |
| Visualizer subscription | existing processor only | analyser tap on active processor | Per-Popup `subscriberId + generation` lease; 5-second heartbeat expiry and bounded tombstone prevent abnormal-exit leaks or delayed-message resurrection. The last live subscriber releases the analyser and cannot create an AudioContext or Capture lease. |

### §8.2 Momentary and compound operations

| Operation | Native-first algorithm | Controlled augmentation or result |
| --- | --- | --- |
| Restore page settings | coordinator releases each owned field | Restores captured per-target baselines; does not translate 100%/1x into release. |
| Effective volume `0–800` | compile current actual, split desired value, use DOM/official native volume first | Within `0–100`, write only native base; within `100–800`, write only hidden Boost; crossing 100 writes both in one rollback-capable coordinator transaction. An identical actual value performs zero Content IPC, revision and storage work. |
| Play/pause toggle | read actual state, then execute the `playing` field plan | Commits only the resulting play/pause event. |
| Relative seek | resolve target and seekable ranges, then execute `currentTime` | Structured unavailable/not-seekable result. |
| Frame step | source-scoped cadence evidence followed by a standard DOM seek | Reuses a recent `requestVideoFrameCallback` cadence or measures bounded consecutive rendered frames while playing; always reports `approximate:true`. A paused source with no cached cadence is unsupported rather than guessed. |
| Screenshot | Chrome `captureVisibleTab` plus verified active-video geometry | A short content-owned capture token is checked before and after browser capture against the same document/source/geometry. There is no second path; protected/hidden/zero-size/unavailable or moving targets return structured errors. |
| Marker add/remove/list | extension state keyed by media/source | No page write. Label and count are bounded. |
| Marker jump/previous/next | marker lookup then native seek plan | Uses the same `currentTime` ACK path. |
| A/B skip | native seek to the verified end boundary | Uses the same target and source revision as the loop. |
| Audio reset | one atomic per-field patch | Returns effective volume to 100%, neutralizes owned DSP and media mute, and releases hidden Boost. Playback speed and pitch preservation are read only as processor context and are never written by reset. |
| Video effects toggle/reset | one atomic patch for extension-owned video fields | Never touches native playback/audio state or site-authored CSS. |
| Show info | snapshot read | Side-effect-free OSD projection. |
| Open Popup/Options | Chrome extension UI APIs | The operation itself only opens browser UI. A rendered foreground Popup may then acquire an observation-only document lease for live page-to-Popup synchronization; that lease never admits MAIN, AudioContext or offscreen processing. |
| Run user script | explicit `userScripts` permission and sandbox | Not a media strategy and never promoted to MAIN adapter access. |
| Open URL | browser navigation with `http/https` allowlist | Not a media strategy; invalid schemes fail closed. |

### §8.3 Disabled legacy algorithms

- Pitch shift hotkeys remain disabled because preserve-pitch is not pitch shifting and no pitch DSP exists.
- `capture_toggle` is a transport implementation leak. Existing bindings migrate to disabled legacy diagnostics.

### §8.4 Surface action normalization

UI labels and protocol commands are aliases of the 51 canonical capabilities,
not additional executors. `HOTKEY_ACTION_DESCRIPTORS` exhaustively maps every
persisted hotkey, including disabled Pitch/Capture legacy actions.
`REMOTE_COMMAND_DESCRIPTORS` does the same for every authenticated phone
command; its values are the only owner of remote step sizes.

Each hotkey descriptor also owns one feedback policy. `actual-osd` means the
field executor renders acknowledged effective-volume/speed state;
`handler-result` means the operation handler renders its semantic result;
`listener-label` permits one generic post-ACK label; `none` is silent. The
listener may not maintain a second action list or add a toast for another
owner. This prevents volume/speed and Marker/A-B actions from producing two
success notifications.

| Remote command family | Canonical capability and transform |
| --- | --- |
| `volume_up/down`, `volume_100`, `volume_max` | `effective-volume`: `+10/-10/set 100/set 800`, clamped `0–800` |
| legacy `boost_up/down/reset/max` | aliases of `effective-volume`: `+10/-10/set 100/set 800`; retained for one release and never exposed as a second state |
| `mute` | `mediaMuted`: toggle; numeric effective volume is preserved |
| `play_pause` | `playback-toggle` |
| `seek_forward/backward*` | `seek-relative`: signed `10s/30s` delta |
| `speed_up/down/reset` | `speed`: `+0.25/-0.25/set 1` |
| `fullscreen`, `pip` | native-only `fullscreen` / `pip` toggle |

Every surface must submit the descriptor's canonical intent. A surface may
coalesce deltas for responsiveness, but it cannot choose another native/MAIN,
CSS, WebAudio or Capture executor.

The current shared media graph and Capture processor both own full output, not a
single selected source. Therefore `audioEnabled`, hidden Boost and every DSP field are
accepted only with `requestedCoverage:'full'`. This is checked again in the
content runtime before configuration mutation, so a malformed/internal
active-target request cannot silently widen itself into whole-tab Capture.

### §8.5 Per-capability native and augmentation ledger

This ledger is deliberately one row per contract capability. `CONTROL_ALGORITHM_ADJUDICATIONS` is its executable owner. `native-only` means no CSS, processor, Capture or generic MAIN fallback exists. `hybrid-extension-native` means extension-owned state performs only bounded selection or estimation before the standard DOM API remains the sole page writer. `augmentation-only` means the product capability has no equivalent page/browser primitive; it does not grant generic interception. Every row preserves zero idle work unless the final column names an owned, subscribed or post-binding browser lifetime.

The exhaustive result is 17 native-only capabilities, six hybrid
extension/native capabilities, 26 augmentation-only capabilities and two
observation-only capabilities. These counts are release-gated: changing a
capability family requires changing the executable adjudication, its source
algorithm anchor, the mirror below and the contract tests in the same commit.

| Contract capability | Native adjudication | Controlled augmentation admission | Success proof and performance boundary |
| --- | --- | --- | --- |
| `audioEnabled` | augmentation-only; there is no page-wide native mode | coordinator-owned session gate only | gate ACK plus expanded actual state for every dependent DSP field; disabling marks retained DSP settings idle and releases all runtime work |
| `volumeBase` | native-only: DOM `volume` first, then a complete official player API if DOM cannot write/read back | none; whole-tab output gain is a different capability and Capture cannot impersonate the page slider | DOM `volumechange` plus getter, or official quiet-window stable getter; no audio runtime for `0–100` native control |
| `boost` | augmentation-only; native volume cannot exceed 100% | proven safe shared media graph, otherwise authorized full-tab Capture | normalized processor gain readback; graph/offscreen exists only while Boost is non-neutral |
| `effective-volume` | hybrid-extension-native: one public value uses DOM/official native base first | hidden Boost is admitted only for the portion above 100 through safe Media WebAudio or acknowledged Capture | one compound ACK returns effective/base/Boost actuals; same-region changes touch one writer, threshold crossings compensate both, repeated actual values do no IPC or persistence |
| `mediaMuted` | native-only: DOM `muted` first, then a complete official player API if DOM cannot write/read back | none; Media WebAudio and Capture are never mute writers or mirrors | official stable getter or `volumechange` getter; numeric volume remains unchanged |
| `tabMuted` | native-only through Chrome tab state | none | `tabs.get`/tab event readback; event-driven only |
| `speed` | native-only: DOM `playbackRate` first, then an official player rate only after proven DOM incompleteness | none | `ratechange` getter or official quiet-window stable getter; no reassert loop |
| `preservePitch` | native-only through standard DOM `preservesPitch` | none | property/getter readback; unsupported rather than echoed intent |
| `playing` | native-only through awaited standard media `play`/`pause` | none | `playing`/`pause` event plus getter; activation rejection is terminal |
| `currentTime` | native-only through a seekable standard media timeline | none | `seeked` plus getter on the same media/source revision |
| `loop` | native-only through standard DOM `loop` | none | authoritative getter; no A/B state alias |
| `pip` | native-only through the standard Picture-in-Picture API | none | enter/leave event and `pictureInPictureElement`; no gesture synthesis |
| `fullscreen` | native-only through the standard Fullscreen API on the selected video | none | `fullscreenchange` and `fullscreenElement`; no CSS fullscreen claim |
| `rotation` | augmentation-only; no implemented native or official adapter exists | reversible extension CSS individual `rotate` | computed style; a never-owned neutral write is DOM-free, while owner removal restores the captured cascade |
| `mirrored` | augmentation-only; no implemented native or official adapter exists | reversible extension CSS individual `scale` | computed style; site `transform` is never replaced |
| `fill` | augmentation-only; no implemented native or official adapter exists | extension-owned `object-fit` rule | computed style; disabling removes ownership rather than guessing a restore value |
| `filterEnabled` | augmentation-only; no implemented native or official adapter exists | reversible composed CSS | computed style; no work while disabled |
| `filter` | augmentation-only; no implemented native or official adapter exists | reversible composed CSS | captures the computed site baseline at acquisition and composes it with SPECTRA values; disabling removes ownership and reveals the site's current cascade |
| `dimEnabled` | augmentation-only; no page/browser dim primitive | extension-owned closed-shadow four-region overlay | overlay geometry readback; one coalesced frame only while enabled; target handoff releases only the previous dim owner and preserves its independent CSS effects |
| `dimOpacity` | augmentation-only; part of the owned dim layer | same owned overlay only | computed/owned opacity readback; no overlay while dim is disabled |
| `abLoop` | augmentation-only metadata; boundary motion still uses native seek | media/source-keyed extension state | coordinator state plus native seek ACK; one scheduler only while enabled |
| `tabPinned` | native-only through Chrome tab state | none | `tabs.get`/tab event readback; event-driven only |
| `eqValues` | augmentation-only; no complete native EQ primitive | proven safe shared media graph or authorized explicit full-tab Capture | processor topology/parameter readback; neutral bands allocate no filters |
| `bass` | augmentation-only; no complete native bass primitive | proven safe shared media graph or authorized explicit full-tab Capture | processor topology/parameter readback; disabled node is absent |
| `compressor` | augmentation-only; no complete native compressor primitive | proven safe shared media graph or authorized explicit full-tab Capture | topology readback; candidate-lane crossfade only during changes |
| `mono` | augmentation-only; no complete native mono primitive | proven safe shared media graph or authorized explicit full-tab Capture | processor matrix/topology readback; disabled splitter/merger path is absent |
| `pan` | augmentation-only; no complete native pan primitive | proven safe shared media graph or authorized explicit full-tab Capture | panner readback; neutral panner is absent |
| `delay` | augmentation-only; no complete native delay primitive | proven safe shared media graph or authorized explicit full-tab Capture | `0–500ms` processor readback; zero delay node is absent |
| `visualizer` | observation-only | explicit subscription to an already-active processor only | subscription state; never creates a graph, Capture lease or hidden Popup IPC |
| `restore-page-settings` | augmentation-only coordinator operation | release each extension-owned field; native fields restore captured baselines through their sole successful writer | site-native baselines survive service-worker restart in session storage; final per-field ACK releases all leases/disposers |
| `playback-toggle` | native-only: observe `playing`, then execute its native plan | none | resulting native play/pause event, not toggle request echo |
| `seek-relative` | native-only: compute against actual time/seekable ranges | none | same native seek ACK used by direct time control |
| `frame-step` | hybrid-extension-native: extension cadence estimation selects an approximate delta, then standard DOM seek remains the only writer | at most eight `requestVideoFrameCallback` observations for the current media/source; require at least three valid deltas and use their median | `seeked` readback and mandatory `approximate:true`; stable samples may finish early, VFR uses the bounded median, and a paused uncached source is unsupported rather than guessed |
| `screenshot` | Chrome-native visible-tab capture, verified crop and completed download ACK | none; browser capture is not DOM/MAIN interception | active/visible geometry, current frame and download-complete readback; no image crosses extension IPC |
| `marker-add` | augmentation-only metadata | bounded media/source-keyed extension state | coordinator snapshot; zero recurring work |
| `marker-remove` | augmentation-only metadata | bounded media/source-keyed extension state | coordinator snapshot; zero recurring work |
| `marker-jump` | hybrid-extension-native: extension state selects one same-source marker, then standard DOM seek is the only writer | bounded marker lookup keyed by media/source | same-source native seek ACK |
| `marker-jump-previous` | hybrid-extension-native: extension state performs a binary predecessor lookup, then standard DOM seek is the only writer | bounded marker lookup keyed by media/source | same-source native seek ACK; no linear full-list scan |
| `marker-jump-next` | hybrid-extension-native: extension state performs a binary successor lookup, then standard DOM seek is the only writer | bounded marker lookup keyed by media/source | same-source native seek ACK; no linear full-list scan |
| `ab-set-a` | augmentation-only media/source-keyed state | bounded A/B state plus one scheduler only after both points are valid | operation result; no page write until an enabled loop reaches B |
| `ab-set-b` | augmentation-only media/source-keyed state | bounded A/B state plus one scheduler only after both points are valid | operation result; rejects `B <= A` and stale source identity |
| `ab-clear` | augmentation-only state release | dispose the owned timer/video-frame callback and remove the same-source points | operation result; recurring work is zero before ACK |
| `ab-skip` | hybrid-extension-native: extension state selects B from the same-source loop, then standard DOM seek is the only writer | bounded A/B state lookup only | same-source native seek ACK |
| `audio-reset` | augmentation-only coordinator compound operation | atomically neutralize/release owned audio fields | per-field snapshot ACK; the native base/media mute writers restore effective volume 100 while hidden Boost is released; speed, pitch preservation and video state are untouched |
| `video-effects-toggle` | augmentation-only coordinator compound operation | acquire/release only extension-owned video fields | per-field computed/overlay readback; no native playback writes |
| `video-effects-reset` | augmentation-only coordinator compound operation | remove only extension-owned CSS/overlay state | restored current cascade readback; zero idle work |
| `show-info` | observation-only | none | authoritative snapshot projection; status read acquires no runtime lease |
| `open-popup` | native-only Chrome extension UI operation | none | operation result; no content runtime |
| `open-options` | native-only Chrome extension UI operation | none | operation result; no content runtime |
| `run-user-script` | augmentation-only sandbox operation | explicit `userScripts` permission and isolated sandbox only | sandbox operation result; never inherits site-adapter MAIN authority |
| `open-url` | native-only browser navigation | none | HTTP(S)-validated operation result; no content emulation |

#### §8.5.1 Executable adjudication mirror

This compact mirror is checked against both `CONTROL_ALGORITHM_ADJUDICATIONS`
and `CONTROL_ALGORITHM_POLICIES`. The descriptive ledger above owns the
reasoning; this table prevents prose from silently changing strategy order,
MAIN admission, ACK evidence or the lifetime of recurring work.

| Capability | Native preference | Augmentation admission | Ordered strategies | MAIN policy | ACK evidence | Recurring work |
| --- | --- | --- | --- | --- | --- | --- |
| `audioEnabled` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `coordinator-snapshot` | `none` |
| `volumeBase` | `native-only` | `none` | `dom-native -> site-native` | `site-adapter-only` | `dom-event-getter + official-stable-getter` | `none` |
| `boost` | `augmentation-only` | `proven-safe-source-or-explicit-full-output` | `media-webaudio -> capture` | `forbidden` | `processor-readback` | `page-lifetime-after-media-binding` |
| `mediaMuted` | `native-only` | `none` | `dom-native -> site-native` | `site-adapter-only` | `dom-event-getter + official-stable-getter` | `none` |
| `tabMuted` | `native-only` | `none` | `chrome-native` | `forbidden` | `chrome-event-getter` | `none` |
| `speed` | `native-only` | `none` | `dom-native -> site-native` | `site-adapter-only` | `dom-event-getter + official-stable-getter` | `none` |
| `preservePitch` | `native-only` | `none` | `dom-native` | `forbidden` | `dom-stable-getter` | `none` |
| `playing` | `native-only` | `none` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `currentTime` | `native-only` | `none` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `loop` | `native-only` | `none` | `dom-native` | `forbidden` | `dom-stable-getter` | `none` |
| `pip` | `native-only` | `none` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `fullscreen` | `native-only` | `none` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `rotation` | `augmentation-only` | `extension-owned-capability` | `extension-css` | `forbidden` | `computed-style` | `none` |
| `mirrored` | `augmentation-only` | `extension-owned-capability` | `extension-css` | `forbidden` | `computed-style` | `none` |
| `fill` | `augmentation-only` | `extension-owned-capability` | `extension-css` | `forbidden` | `computed-style` | `none` |
| `filterEnabled` | `augmentation-only` | `extension-owned-capability` | `extension-css` | `forbidden` | `computed-style` | `none` |
| `filter` | `augmentation-only` | `extension-owned-capability` | `extension-css` | `forbidden` | `computed-style` | `none` |
| `dimEnabled` | `augmentation-only` | `extension-owned-capability` | `extension-overlay` | `forbidden` | `overlay-readback` | `while-owned` |
| `dimOpacity` | `augmentation-only` | `extension-owned-capability` | `extension-overlay` | `forbidden` | `overlay-readback` | `while-owned` |
| `abLoop` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `coordinator-snapshot + dom-event-getter` | `while-owned` |
| `tabPinned` | `native-only` | `none` | `chrome-native` | `forbidden` | `chrome-event-getter` | `none` |
| `eqValues` | `augmentation-only` | `proven-safe-source-or-explicit-full-output` | `media-webaudio -> capture` | `forbidden` | `processor-readback` | `page-lifetime-after-media-binding` |
| `bass` | `augmentation-only` | `proven-safe-source-or-explicit-full-output` | `media-webaudio -> capture` | `forbidden` | `processor-readback` | `page-lifetime-after-media-binding` |
| `compressor` | `augmentation-only` | `proven-safe-source-or-explicit-full-output` | `media-webaudio -> capture` | `forbidden` | `processor-readback` | `page-lifetime-after-media-binding` |
| `mono` | `augmentation-only` | `proven-safe-source-or-explicit-full-output` | `media-webaudio -> capture` | `forbidden` | `processor-readback` | `page-lifetime-after-media-binding` |
| `pan` | `augmentation-only` | `proven-safe-source-or-explicit-full-output` | `media-webaudio -> capture` | `forbidden` | `processor-readback` | `page-lifetime-after-media-binding` |
| `delay` | `augmentation-only` | `proven-safe-source-or-explicit-full-output` | `media-webaudio -> capture` | `forbidden` | `processor-readback` | `page-lifetime-after-media-binding` |
| `visualizer` | `observation-only` | `existing-processor-only` | `observe` | `forbidden` | `subscription-state` | `while-subscribed` |
| `restore-page-settings` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `coordinator-snapshot` | `none` |
| `effective-volume` | `hybrid-extension-native` | `proven-safe-source-or-explicit-full-output` | `dom-native -> site-native -> extension-state -> media-webaudio -> capture` | `site-adapter-only` | `dom-event-getter + official-stable-getter + processor-readback` | `none` |
| `playback-toggle` | `native-only` | `none` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `seek-relative` | `native-only` | `none` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `frame-step` | `hybrid-extension-native` | `extension-owned-capability` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `screenshot` | `native-only` | `none` | `chrome-native` | `forbidden` | `operation-result` | `none` |
| `marker-add` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `coordinator-snapshot` | `none` |
| `marker-remove` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `coordinator-snapshot` | `none` |
| `marker-jump` | `hybrid-extension-native` | `extension-owned-capability` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `marker-jump-previous` | `hybrid-extension-native` | `extension-owned-capability` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `marker-jump-next` | `hybrid-extension-native` | `extension-owned-capability` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `ab-set-a` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `operation-result` | `none` |
| `ab-set-b` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `operation-result` | `none` |
| `ab-clear` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `operation-result` | `none` |
| `ab-skip` | `hybrid-extension-native` | `extension-owned-capability` | `dom-native` | `forbidden` | `dom-event-getter` | `none` |
| `audio-reset` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `coordinator-snapshot` | `none` |
| `video-effects-toggle` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `coordinator-snapshot` | `none` |
| `video-effects-reset` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `coordinator-snapshot` | `none` |
| `show-info` | `observation-only` | `none` | `observe` | `forbidden` | `coordinator-snapshot` | `none` |
| `open-popup` | `native-only` | `none` | `chrome-native` | `forbidden` | `operation-result` | `none` |
| `open-options` | `native-only` | `none` | `chrome-native` | `forbidden` | `operation-result` | `none` |
| `run-user-script` | `augmentation-only` | `extension-owned-capability` | `extension-state` | `forbidden` | `operation-result` | `none` |
| `open-url` | `native-only` | `none` | `chrome-native` | `forbidden` | `operation-result` | `none` |

### §8.6 Native versus interception adjudication for every algorithm

The two matrices above are exhaustive: 28 persistent snapshot fields plus 23 momentary
operations. The following adjudication explains when each family stays native,
when controlled augmentation is admitted, and which apparent fallback is
forbidden. It is normative together with `CONTROL_ALGORITHM_POLICIES`.

The exhaustive totals are part of the review result, not a loose summary:

- **17 native-only** capabilities may use only standard DOM, an allowlisted
  official player API, or a Chrome/browser API. A failure never promotes them
  to CSS, WebAudio, Capture or generic MAIN interception.
- **6 hybrid-extension-native** capabilities combine a native writer with
  bounded extension-owned coordination. Five source/timeline operations still
  end in standard DOM seek; effective volume adds hidden processor gain only
  above the native ceiling and never exposes the implementation split.
- **26 augmentation-only** capabilities have no implemented equivalent native primitive.
  They are admitted only to their named extension-state, overlay, safe media
  processor, authorized full-output Capture or sandbox owner; this category is
  not permission for generic page interception.
- **2 observation-only** capabilities may read a snapshot or an already-owned
  analyser subscription and must never acquire a writer or processing lease.

These four sets total all 51 contract capabilities. Any future capability must
enter exactly one set through `CONTROL_ALGORITHM_ADJUDICATIONS`, receive its own
ordered strategy/readback/lifetime policy, and add the exact mirror row above
before compilation and architecture verification can pass.

| Capability family | Native completeness test | Controlled augmentation admission | Forbidden hijack/fallback |
| --- | --- | --- | --- |
| Audio enable/restore/reset | no page primitive; expand one coordinator transaction into owned fields | `extension-state` only, releasing or neutralizing each owned field with readback | page-wide mode flags, optimistic badge/UI state, starting audio on a read |
| Effective volume and media mute | one public `0–800` value compiles to native base plus hidden Boost; mute remains a separate native boolean | Boost above 100 uses proven safe shared Media WebAudio, otherwise acknowledged Capture; mute has no processor fallback | Capture inferred from value, simultaneous native writers, changing numeric volume to implement mute, page AudioContext destination interception |
| EQ, Bass, Compressor, Mono, Pan, Delay | no complete browser-native primitive | proven safe shared Media WebAudio; otherwise authorized Capture when full/opaque scope is requested | binding unknown cross-origin media as a probe, generic MAIN DSP, silent-output CORS inference |
| Tab mute and pin | Chrome API write plus `tabs.get`/event readback | none | content DOM emulation or optimistic Chrome ACK |
| Speed and pitch preservation | speed may fall back to the implemented YouTube official API; pitch preservation is standard DOM-only | none beyond the registered speed adapter | prototype/setter patching, default-speed reassert loops, echoing requested pitch as actual |
| Play/pause, seek, whole-media loop | awaited standard media operation on the resolved media/source only | A/B and markers may own metadata, but their jumps still call the same native seek executor | nonexistent site-adapter promises, autoplay/activation bypass, direct timeline writers in helpers, hard-coded frame rate presented as exact |
| PiP and fullscreen | standard browser API plus native event/getter only; Popup PiP may hand off to one bounded page-click prompt after the native activation error | one extension-owned prompt with no media-writing authority | nonexistent site-adapter promises, synthetic hover/focus, fabricated user activation, CSS theater mode reported as fullscreen, retaining the prompt/listener after click, timeout or runtime disposal |
| Rotate, mirror, fill and filters | no implemented native candidate in this release | reversible extension-owned CSS attributes/variables with computed-style readback; Filter captures a baseline because CSS has no additive Filter primitive | hypothetical site-native entries without an adapter, inline-style replacement, guessed restoration, claiming dynamic site Filter composition while owned, MAIN style patching |
| Dim background | no native primitive | four-region closed-shadow overlay while owned, with one coalesced geometry frame | mutating target `position`/`z-index`, permanent observer/rAF, fullscreen audio reapply |
| A/B and markers | native media time/readback is used only for the final seek | extension state keyed by `mediaId + sourceRevision`, bounded scheduler only while A/B is enabled | document-global state, direct `currentTime` writes, timers/listeners after release |
| Visualizer | observe an existing processor only | analyser tap while explicitly subscribed | creating WebAudio/Capture for visualization, per-card IPC/rAF, analyser allocation per sample |
| Screenshot | verified Chrome `captureVisibleTab` crop for the visible active video | no fallback after browser capture/readback failure | canvas-from-media CORS probing, DRM patching, image IPC, or claiming success before download completion |
| Open UI/URL, tab actions | Chrome/browser primitive and operation result | none | content emulation, unvalidated URL schemes |
| User script | no media-native primitive | explicit userScripts sandbox and permission only | sharing site-adapter MAIN authority or treating arbitrary script execution as a control strategy |
| Show info and all getters | authoritative snapshot/getter observation | none | acquiring runtime, observer, MAIN, AudioContext, offscreen lease or writer ownership |

Every individual capability still follows its own row in
`CONTROL_ALGORITHM_POLICIES`; sharing a family in this explanation never permits
one field's strategy to select a page-wide mode for another field.
- Frame stepping must not retain the fixed `1/30s` approximation as an asserted exact result.
- `fx_toggle`, resets and other compound actions expand into typed field intents; they never bypass the planner.

#### §8.6.1 Algorithm entry points and implementation anchors

The 51 capabilities intentionally do not all enter through `ControlPatch`.
`CONTROL_FIELDS` contains 28 snapshot fields and `CONTROL_OPERATIONS` contains
23 momentary operations. Of the fields, `CONTROL_DIRECT_FIELDS` contains the 26
ordinary patch/read/mutation fields. `abLoop` can change only through the typed
`ab-*` operations, and `visualizer` can change only through its subscription
protocol. Runtime validation rejects either field in an ordinary patch before
an executor runs. This distinction prevents a valid algorithm from drifting
into a generic unsupported path merely because it is represented in the shared
snapshot.

The following locations are normative implementation anchors. A change that
moves responsibility must update this list, the executable matrices, tests and
`check-spectra-control.js` in the same commit.

| Location and symbol | Owned decision | Purpose / drift prevented |
| --- | --- | --- |
| `packages/contracts/src/control.contracts.ts::CONTROL_DIRECT_FIELDS` and validators | Which snapshot fields may use direct patch/read/mutation | Keeps A/B operations and Visualizer subscriptions out of generic field execution. |
| `packages/features/audio-engine/src/CapabilityPlanner.ts::plan` | Per-capability ordered strategy and admission | Requires explicit full coverage for the current shared Media WebAudio graph; neither safe media nor Capture may widen an active-target DSP intent. |
| `src/content/logic/audio-runtime-control-delegate.ts::createAudioRuntimeControlDelegate` | Full-output DSP intent compilation and actual field expansion | Defines `audioEnabled` as a coordinator session gate, exposes dependent startup errors, and reports dependent fields idle on disable without deleting saved values. |
| `src/background/main-runtime-manager.ts::applyMainSiteControl` | One allowlisted MAIN setter/getter call | Captures official pre-write and post-write values without installing a bridge, wrapper, listener or descriptor patch. |
| `src/background/control-coordinator.ts::applySiteNativeFallback` and `restoreSiteNativeFields` | Site-native baseline lifetime and restore ordering | Persists the first official baseline by tab/document/generation, absorbs exact reflected events, restores through the same writer and prevents DOM restore from competing. |
| `src/background/control-coordinator.ts::applyChromeTabObservation` | Browser-side tab mute/pin observation | Absorbs events reflected by the coordinator's own Chrome write and publishes genuine Chrome UI changes as `controlled:false`, so Popup/remote stay synchronized without polling. |
| `src/content/logic/native-media-executor.ts::releasePageSettings` | DOM/CSS/overlay release | Skips fields owned by a successful official adapter and removes only extension-owned presentation state. |
| `src/content/core/media-registry.ts::refreshSource` and `fullscreenListener` | Media/source identity and page-side fullscreen observation | Reused elements emit logical remove/register around `sourceRevision`; removed-source owners dispose immediately, while fullscreen enter/exit is attributed to the actual media rather than whichever target was previously active. |
| `src/content/video/video-effects-controller.ts::apply` and `assertOwnerReadback` | Reversible CSS/overlay ownership | Positive effects require computed/overlay readback; disabling rotation, scale, fill and filter requires owner attributes and variables to be absent before ACK. |
| `src/content/logic/control-operation-executor.ts::executeControlOperation` | Contract-scoped target resolution and momentary operation truth | `active-video` operations resolve the independent video registry target while media/source operations resolve active media; missing marker/media/A-B targets reject instead of returning an `ok` envelope with a false action result. |
| `src/background/control-coordinator.ts::executeFieldOperation` | Compound operation transaction | Playback, seek, video toggle/reset and audio reset require every relevant field phase to be `applied` before returning operation success. |
| `packages/contracts/src/control.contracts.ts::isControlStrategyAdmittedForCapability` and ACK validators | Capability-specific cross-process strategy admission | Reject a known strategy name when it belongs to another capability, so stale or drifting executors cannot report Capture volume, CSS fullscreen or extension-state screenshot success. |
| `packages/contracts/src/spectra.ui-runtime.ts::SPECTRA_UI_REQUEST_TYPES` and `SPECTRA_UI_EVENT_TYPES` | Closed protocol surface for Popup, Options and remote UI | The 23 request types and six event types are explicit tuples. UI clients are compile-time limited to that subset; success, error and event envelopes reuse canonical control/settings/audio/remote validators. `test/ui-runtime-contract.spec.ts` proves parity and rejects internal types even when they carry a syntactically valid shared error. |

`audioEnabled.actual` is derived from the requested configuration and actual
processor state. A neutral enabled configuration may report `true` while the
runtime remains `bypass`, because no processor is required. When any non-neutral
Boost/DSP field is requested, `audioEnabled.actual` becomes `true` only after a
Media WebAudio or Capture processor returns complete actual readback. Processor
startup failure reports `audioEnabled.actual:false`, `phase:error` together with
the failing DSP field; no desired value is copied into actual state.

### §8.7 Complete hotkey algorithm mapping

`HOTKEY_ACTION_DESCRIPTORS` is exhaustive for every persisted shortcut. It maps the UI label to a canonical field/operation, repeat policy, parameter schema and activation requirement before a handler is exposed.

| Shortcut family | Exact mappings | Repeat/activation decision |
| --- | --- | --- |
| Playback | `play_pause -> playback-toggle`; each `seek_*_5s/10s/30s -> seek-relative`; each `seek_frame_* -> frame-step` | seek/frame deltas coalesce at 20 Hz; play toggle ignores repeat and preserves the trusted key event for native `play()` |
| Speed | `speed_up/down/reset/set -> speed` | up/down coalesce at 20 Hz; reset/set ignore repeat; `speed_set` requires validated parameter |
| Volume | `volume_up/down/set -> effective-volume`; `volume_mute -> mediaMuted` | up/down/set accept `0–800`, coalesce at 20 Hz and use the same atomic split as Popup/remote; identical values are dropped before IPC; mute ignores repeat |
| Audio DSP | `audio_reset -> audio-reset`; legacy `gain_up/down/reset -> effective-volume`; `delay_* -> delay`; `pan_* -> pan`; `mono_toggle -> mono` | gain aliases no longer own product state; continuous deltas coalesce at 20 Hz; resets/toggles ignore repeat |
| Video | `fullscreen_toggle -> fullscreen`; `pip_toggle -> pip`; `rotate_cw/ccw -> rotation`; `mirror_toggle -> mirrored`; `screenshot -> screenshot`; `dim_background -> dimEnabled` | PiP/fullscreen/screenshot require a real user-activation-capable entry and never escalate around rejection; screenshot is single-fire |
| Timeline | `marker_add -> marker-add`; `marker_jump_prev/next -> marker-jump-previous/next`; `ab_set_a/b/clear -> abLoop`; `ab_skip -> ab-skip`; `loop_toggle -> loop` | jumps/skips coalesce; state mutations and loop toggle ignore repeat and remain bound to media/source identity |
| Effects | `fx_toggle/reset -> video-effects-toggle/reset` | one typed compound patch; ignores repeat |
| Tab | `tab_pin -> tabPinned`; `tab_mute -> tabMuted` | Chrome-native readback; ignores repeat |
| Utility | `show_info -> show-info`; `open_popup/options -> open-popup/options`; `run_js -> run-user-script`; `open_url -> open-url` | single operation; script/URL require validated parameters and URL is limited to HTTP(S) |
| Legacy/no-op | `pitch_up/down/reset`, `capture_toggle -> disabled-legacy`; `none -> no-op` | existing bindings migrate disabled; Capture remains automatic and Pitch DSP remains outside scope |
