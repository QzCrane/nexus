---
type: reference
status: stable
audience: developer
---

# 06. Media & Video (Active media, media controls, video effects)

> 主题 owner 段: §13 Active media · §14 Media controls · §15 Video effects and screenshot
> 完整目录: [control-architecture.md](../control-architecture.md)

## §13 Active media

Each registered media element has a document-scoped target:

```ts
interface MediaTarget {
  frameId: number;
  documentId: string;
  mediaId: string;
  sourceRevision: number;
  kind: 'audio' | 'video';
}
```

`sourceRevision` increments on source replacement. Active selection is sticky and changes only for a stronger event, removal or source change:

1. explicit `mediaId` target;
2. most recent trusted interaction;
3. most recent play;
4. currently playing media;
5. registration-time viewport geometry, then cached IntersectionObserver visibility/area;
6. registration order.

The current product scope is the top-level document only (`frameId: 0`). Same-origin
and cross-origin iframe media are not silently treated as covered; adding them
requires frame-scoped runtime leases, routing, navigation invalidation and Chrome
integration evidence before the manifest may enable `all_frames`.

Once the optional runtime is leased, control commands resolve only through the
event-driven registry and never rescan the document or force layout. Before that
runtime exists, a passive Popup/remote snapshot read may perform one bounded
top-level `video,audio` lookup in the lightweight bootstrap. After the document
initialization barrier, two capture-phase native event listeners may also report
the complete volume/mute or speed/pitch actual pair without inventing a media ID.
They retain only one latest patch behind one in-flight coordinator request and
yield immediately when the registry runtime starts. Neither path creates a
MutationObserver, stable media ID, timer, processing path or direct storage
writer; all writes and target-bound subscriptions acquire the registry runtime
first. Audio-only pages
support speed, pitch preservation, play/pause, seek, loop, markers and A/B.
Video-only features are disabled only when no independent `activeVideo` exists;
an audio `activeMedia` does not hide or receive video controls.

The identity and selection edge cases are part of the algorithm contract, not
implementation trivia:

| Edge | Required result | Owner and purpose |
| --- | --- | --- |
| Repeated `load()` with the same URL | The first `emptied`/`loadstart` opens one logical load epoch and increments `sourceRevision`; the paired event does not increment again, and `loadedmetadata` closes the epoch. | `MediaRegistry::refreshSource`; prevents source-scoped Marker/A-B/CSS/DSP state from leaking into a restarted resource while avoiding a double revision for one browser load. |
| `srcObject` replacement | Object identity participates in the source key, so each distinct stream increments `sourceRevision` even when URL getters stay empty. | `MediaRegistry::sourceIdentity`; gives MediaStream playback the same stale-ACK protection as URL media. |
| Framework reparent | Removal is finalized in a microtask only when `isConnected` remains false; remove+add in one mutation turn preserves `mediaId` and `sourceRevision`. | `MediaRegistry::queueRemovalTree`; avoids tearing down listeners/graph ownership during a layout-only move. |
| Pre-rendered SPA modal | Registration seeds visible area synchronously because the first `IntersectionObserver` delivery is asynchronous. Registration, metadata, play and trusted selection each admit one exact-target desired replay; a `pushState` URL change alone does not guess a media identity. | `MediaRegistry::register` and `NativeMediaExecutor::replayDesired`; prevents an immediate restore from choosing an older hidden feed source and lets an already-registered modal inherit current configuration when it becomes active. |
| Snapshot/target read | `peek`, `resolve` and `resolveVideo` are pure. Only `select` or a stronger native event changes sticky selection. | `MediaRegistry::selectRecord`; opening UI or reading status cannot retarget playback. |
| Fullscreen player container | Exact media ownership wins; otherwise a contained sticky video wins, then the best contained video, before any contained audio fallback. Exit is attributed to the remembered entry target. | `MediaRegistry::fullscreenRecord`; page-owned container fullscreen updates `activeVideo` without letting an audio element steal the video ACK. |

### §13.1 ACK target projection

`ControlApplyAck.target` and `ControlOperationAck.target` identify the source that
actually executed an algorithm. They are not a third state owner and must not be
copied into both active identities. Background projects the acknowledged target
from the capability scope in `CONTROL_ALGORITHM_POLICIES`:

| Contract scope | `activeMedia` projection | `activeVideo` projection | Reason |
| --- | --- | --- | --- |
| `active-media`, `media-source`, `requested-audio-scope` | replace with the actual ACK target | also replace only when that target is video | transport/audio actions establish the media source they actually controlled |
| `active-video` | preserve | replace only with an actual video ACK target | PiP, fullscreen, frame step, CSS/overlay and screenshot must not steal an independently playing audio target |
| `tab`, `document`, `extension-ui`, `sandbox` | preserve | preserve | tab mute/pin, session gates, UI and sandbox operations have no media-selection authority |

An explicit registry `selected` event is the only scope-free selection input: it
updates `activeMedia`, and additionally `activeVideo` when the selected target is
a video. Source release clears only the matching identity. A pure snapshot read
may return a fresher view of both targets but does not persist, publish, acquire a
runtime or increment a revision. Popup video surfaces preserve their local
`activeMedia` while merging a video ACK; the next authoritative snapshot push
remains the final UI truth.

Because the v2 ACK carries one actual `target`, a single request that mixes
media-scoped and video-scoped fields is accepted only with one explicit video
target that can truthfully own both results. A null-target mixed request is
rejected before any page read/write; callers split independent media and video
controls into serialized intents instead of letting active-audio selection
silently route a video field to the wrong element.

## §14 Media controls

| Field | Preferred implementation | Escalation |
| --- | --- | --- |
| speed | exact-element page controller getter/setter, then standard `playbackRate` | an unowned page candidate that synchronously or asynchronously caps the requested value restores its baseline before DOM admission; DOM requires correlated `ratechange` plus getter, and the field is unsupported only after both native candidates fail |
| preserve pitch | `preservesPitch` capability/readback | unsupported when the standard property is absent |
| play/pause | awaited `play()` / `pause` event | unsupported on native failure; never bypass autoplay |
| seek | seekable `TimeRanges` + `seeked` readback | unsupported when the standard timeline is unavailable |
| frame step | cached or bounded live `requestVideoFrameCallback` cadence, then native seek | always reports approximate; paused-without-evidence and unmeasurable cadence are unsupported rather than guessed |
| whole-media loop | `media.loop` readback | unsupported |
| PiP | Picture-in-Picture API + enter/leave events | no MAIN workaround |
| fullscreen | Fullscreen API on the active video | unsupported on native failure; no gesture workaround |

The same exact-element `page-native -> dom-native` order applies to page volume,
media mute, and playback speed. Page-native discovery is bounded and
domain-neutral; it retains no player object or site UI listener. A page
controller's mere presence is not admission for a value it cannot truthfully
read back: before ownership, a baseline-restored rejection falls through once
to the standard DOM writer. Events emitted by either candidate during that
transaction are correlated with the pending field instead of racing a new
revision. Later normal media events read the stable selected writer so page
changes, Popup changes, restore, and hotkeys converge on the one coordinator
snapshot without a reassert loop. Standard speed writes keep
`defaultPlaybackRate` and `playbackRate` coherent when the page has not already
separated them, allowing a player UI that projects the standard default to
update from the same native `ratechange` ACK. A
cold bootstrap event is document-scoped rather than media-scoped: it can preserve
only volume/mute and speed/pitch across a same-origin refresh, never select a
target or claim plugin badge usage.

PiP and fullscreen failures distinguish unsupported, disabled and user-activation-required. A Popup or remote command cannot manufacture page transient activation. Popup PiP converts only `user-activation-required` into an explicit page interaction: it arms a typed, bounded prompt, activates the already-bound tab, and waits for the user's real click. The click invokes the same native executor before the first asynchronous boundary; it does not admit MAIN, Capture or a domain adapter.

A/B state and markers are keyed by `mediaId + sourceRevision`. A/B uses one
boundary timer, optionally switching to `requestVideoFrameCallback` near B;
one parallel near-boundary timer preserves the boundary when a hidden tab stops
delivering frame callbacks. Explicit skip suppresses re-entry until playback
returns below B. Boundary, skip and every Marker jump publish the exact native
seek readback rather than the stored marker/point value. No timer/rAF/listener
remains when the loop is disabled.

## §15 Video effects and screenshot

- Rotate and mirror use individual CSS `rotate`/`scale` properties owned through extension attributes/variables; they do not overwrite site `transform`.
- Fill uses an extension-owned `object-fit:cover` rule. Disabling removes the owner attribute instead of writing `contain`.
- Filters never replace the site's inline source style. At acquisition they capture the computed baseline and compose SPECTRA values; CSS has no additive Filter primitive, so site Filter changes while owned are not claimed as live-synchronized. Disable, removal, navigation and handoff remove only extension-owned attributes/variables and reveal the site's then-current cascade.
- Popup Filter editing sends `{filter, filterEnabled:true}` as one intent. Input presentation updates locally, transport is capped at 20 Hz with one in-flight and one latest pending value, and only the actual ACK replaces the UI snapshot; a slider can never acquire ownership in a separate partial transaction.
- Dim uses four fixed overlays in a closed shadow host around the active video. It never changes the video's `position` or `z-index`.
- Every applied style is confirmed with computed-style readback and has one disposer.
- Screenshot has one Chrome-native algorithm: verify the complete active video is visible and has a current frame, call `captureVisibleTab`, crop inside Background, then ACK only after the Chrome download reports `complete`. It returns metadata, never image bytes through extension IPC. DRM/protected, zero-size, hidden-tab and unavailable-frame cases return structured errors.
