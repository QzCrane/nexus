---
type: reference
status: stable
audience: developer
last_reviewed: 2026-07-26
---

# 02. Strategy order & Routes (Capability order, registry, runtime, bridges)

> 主题 owner 段: §3 Strategy order · §4 Site route registry · §5 Runtime ownership · §6 Exact-element page media, PiP & fullscreen
> 完整目录: [control-architecture.md](../control-architecture.md)

## §3 Strategy order

For each capability, the planner removes candidates that cannot cover the requested scope or cannot return actual readback, then follows that capability's own order.

```text
OBSERVE
  -> CAPABILITY-SPECIFIC NATIVE CANDIDATES
       (PAGE_NATIVE / DOM_NATIVE / CHROME_NATIVE)
  -> CAPABILITY-AUDITED CONTROLLED AUGMENTATION
       (EXTENSION_STATE / CSS / OVERLAY / SAFE_MEDIA_WEBAUDIO / CAPTURE)
  -> UNSUPPORTED
```

### §3.1 Forbidden generic MAIN behavior

Production code must not replace or redefine:

- `window.AudioContext` or `webkitAudioContext`;
- an `AudioContext` instance's `destination` or `close`;
- `window.Audio`;
- `document.createElement` or `createElementNS`;
- `HTMLMediaElement` prototype descriptors;
- History API methods from an isolated-world runtime.

MAIN execution is limited to the fullscreen V1 bridge
(`content-fullscreen-bridge.js`) and exact-element page-media V2 bridge
(`content-page-media-bridge.js`) registered in the manifest at
`document_start`. The fullscreen bridge wraps only the native fullscreen entry
to coordinate a bounded audio handoff. The page-media bridge handles only
`volumeBase`, `mediaMuted`, and `speed` on the exact request target.

### §3.2 Native, augmentation and forbidden hijack

The implementation must not hide invasive behavior under the word "native". Every selected strategy belongs to one of these classes:

| Class | Strategies | Meaning |
| --- | --- | --- |
| observe | `observe` | Read authoritative events/getters without acquiring control. |
| native | `page-native`, `dom-native`, `chrome-native` | Use a page controller or browser-owned API/property with exact readback. `page-native` is admitted only through the bounded exact-element bridge. |
| controlled augmentation | `extension-state`, `extension-css`, `extension-overlay`, `media-webaudio`, `capture` | Add a reversible extension-owned capability only when complete native control is unavailable. |
| unsupported | `unsupported` | Preserve the page and return a structured capability error. |

Generic constructor, prototype, descriptor, setter, `createElement`, History API and page-AudioContext interception are forbidden hijacks. They are not planner candidates. A controlled augmentation must have a bounded owner, actual readback, a disposer and a restore rule; otherwise it is unsupported.

## §4 Site route registry and eligibility cache

The registry is a capability-route cache, not a pair of competing site lists or
a log of video instances. The Background repository owns one persisted route per
normalized site and the policy executor owns one in-memory decision per document:

```ts
type SiteRouteRecord = {
  domain: string;
  fingerprint: `site:${string}`;
  route: 'direct' | 'capture';
  source: 'user' | 'auto';
  updatedAt: number;
};
```

Resolution is deterministic: a user-pinned site route wins, then the latest
automatic site observation, then the native/direct default. Every opened video
updates the current document's evidence only; an acknowledged route updates the
existing site record in place. Legacy `media:v1:*` entries are accepted during
read and collapsed by normalized domain, with user entries preferred over
automatic observations. The Popup and Options pages render and edit the same
registry-v2 list through the Background repository, so one site never expands
into a second list of video rows.

Eligibility is a routing hint, not activation. A cached `capture` route does not
create an offscreen document, a processor, or a purple status. Capture is lazily
activated only after a control transaction proves that direct/native coverage is
insufficient, a full-output processor is explicitly needed, and Background has
admitted that transaction from an extension invocation on the current active
tab. A cached route is
invalidated on document identity changes, runtime disposal, unsupported/terminal
errors and a newer user decision. Actual mode and UI color still come only from
the current `AudioSessionSnapshot` ACK.

### §4.1 Last-resort Capture fallback

A user-pinned `direct` route is authoritative for routing, but it cannot grant
Media WebAudio access to a cross-origin media source. When `assessMediaSourceCoverage`
reports `fullCoverage: false` on the NATIVE_WEBAUDIO path and the requested
configuration explicitly needs a processor (`requiresAudioProcessor` is true —
volume > 100, non-zero EQ, bass, compressor, mono, pan, or delay), the executor
escalates to Capture as the last-resort full-output path before falling back to
`bypass+error`. Capture is chosen because `tabCapture` is not blocked by page
CORS, so a site that was mistakenly pinned to `direct` can still be served when
the user actually requests a processor-backed configuration.

The escalation is invocation-bound. Background mints a volatile
`captureAdmission: 'extension-invocation'` only for a Popup transaction or
validated shortcut whose resolved target is still the active tab. A page
shortcut qualifies only when the sender is the current top-level HTTP(S)
document, carries its exact `documentId`, and originated in the trusted
isolated-world keyboard boundary; Background rechecks that document immediately
before minting admission. The field exists only on the internal `ControlIntent`;
`ControlSubmitRequest` rejects it, so playback, arbitrary page state,
`navigator.userActivation`, warm-update restore, navigation, authenticated
remote control, and an alternate shortcut target cannot manufacture admission.
An already active Capture may be configured or stopped without a second
admission.

An admitted transition follows SCTRL-011 — the processor handoff never
double-applies DSP, never ACKs before actual readback, and a candidate failure
retains the browser denial in `lastError`. Without admission the executor returns
`bypass+error` without calling `getMediaStreamId()`. A transparent configuration
(no boost, no DSP) never escalates, because a
coverage gap without a processor need is reported directly through the bypass
path and does not justify the invocation-bound Capture lease.

When Capture is acknowledged `active`, `recordActual` corrects the registry so
the next document skips the futile native attempt. A user-pinned `direct` route
remains authoritative for `resolve` (mode selection still honors it), but the
acknowledged Capture proves the pinned route is wrong: `persist` runs with
`force: true`, propagating through `markRegistryDomainProbed` → the
`spectra.registry.mark-probed` payload → `RegistryRepository.markProbed` → the
kernel storage's `addOrUpdateDomain`, where `force` bypasses the
`user_override` rule that normally prevents an automatic observation from
overwriting a user-pinned route. The overwritten entry becomes `capture/auto`,
so the next document hydrates with `manualStatus = null` and `resolve` returns
`RESTRICTED` without trying native first. The in-memory `manualStatus` is
cleared on the same force path, so the current document also honors the
corrected route on subsequent `resolve` calls. The correction is asymmetric:
acknowledged Capture overwrites a user-pinned `direct`, but acknowledged WebAudio
never overwrites a user-pinned `capture` (`force` is only set when
`actualMode === 'capture'`), because the user may have intentionally chosen
Capture for a site where WebAudio coverage is fragile.

## §5 Runtime, shortcut and feedback ownership

The content bootstrap is cold-document safe. The first hotkey on a newly loaded
document performs an identity-bound runtime ensure, waits for the READY barrier,
and only then submits its intent; opening Popup is not a prerequisite. READY is
invalidated by navigation, extension update, context invalidation and dispose,
and a timed-out handshake returns a structured error without an unhandled
Promise rejection.

All five shipped defaults have one page gesture owner in the
`document_start` bootstrap: `Alt+ArrowLeft/Right` applies literal
`-0.1/+0.1` speed deltas, `Alt+ArrowDown/Up` applies `-10/+10`
effective-volume deltas, and `Alt+M` toggles media mute once per physical
press. The shared bootstrap resolver is also the heavy site-hotkey listener's
exclusion boundary, so that listener cannot consume any of these five chords a
second time. None is registered as a manifest command or default Chrome command
slot, eliminating the competing `chrome.commands` stream that cannot expose
physical keyup. The same contract excludes every `coalesce-20hz` action from
configurable Chrome command slots; continuous actions remain available through
page bindings with real keydown/keyup ownership.

The five built-in chords are also reserved at the settings boundary. Options,
wire validation and the Background settings repository project `KeyCombo`
through the same bootstrap resolver instead of maintaining another reserved-key
list. A new site binding on one of those chords is rejected. A previously
persisted collision is retained only as `enabled: false` migration evidence with
`disabledReason: 'reserved_default_chord'`, is repaired durably without changing
the user-visible settings revision, and can be reassigned to a non-reserved
combination that clears the disabled reason. The UI must explain that conflict;
it cannot report a successful binding that the runtime will never execute.

The minimal bootstrap accepts only trusted exact-modifier events outside
editable controls. The five shipped chords are reserved extension commands:
their `document_start` `window` capture boundary calls `preventDefault()` and
`stopImmediatePropagation()` on accepted keydown and matching keyup before page
handlers can apply a competing native-only write. This exclusive boundary is
limited to the five centrally declared defaults; it assigns the monotonic
gesture identity and sends the closed
`spectra.content.default-hotkey.trigger` request. Repeated `Alt+M` keydown events
are ignored until keyup rather than toggling mute repeatedly.

Configured site bindings use the separate shared website-first arbiter. Its
permanent `window` capture listener recognizes a candidate and appends a
temporary `window` bubble tail for that exact `KeyboardEvent`. Website target
and document handlers plus pre-existing `window` listeners therefore run first.
`defaultPrevented`, `cancelBubble`, or propagation that never reaches the tail
withdraws the configured binding. `setTimeout(0)` only rejects and cleans an
unreachable tail; a microtask is forbidden. An accepted configured binding calls
only `preventDefault()` and leaves propagation open. Candidate resolution is
frozen during capture so settings work in the same dispatch cannot remap it.
Closed-shadow editable retargeting and a same-dispatch dynamically added
`window` listener remain explicit website-first platform limits.

Accepted site gestures use a separate release boundary because cleanup must not
depend on website propagation. The first `document_start` Bootstrap installs one
stable trusted-keyup capture observer; Bootstrap revision replacement hands off
only its mutable subscriber and never removes/re-appends that raw listener behind
website listeners registered meanwhile. It publishes only a live `{ code }`
signal inside the isolated world, never queues an old release and never mutates
the website event. The heavy site runtime subscribes before enabling its keydown
arbiter. Repeat pulses and in-flight work are keyed by gesture. Pulses can be
consumed only when another physical repeat arrives after the cadence boundary;
there is no delayed action timer and transaction completion cannot self-drain.
Keyup, blur, pagehide, settings invalidation and disposal discard unconsumed
pulses. A new non-repeat press retires a same-code stale gesture defensively, so
its old completion cannot block or release the new press.

Background accepts it only from the current top-level HTTP(S) document, keys
work by `tabId + documentId + action + gesture`, rechecks identity immediately
before the writer, and treats the first accepted press as a committed
transaction even when keyup arrives during cold runtime acquisition. Keyup
clears only unconsumed repeats and waits for that sole in-flight operation
before acknowledging release. A same-document history/hash/modal URL change
retains `documentId` and cannot be rejected by URL-string equality; the current
frame URL is used only for route/domain projection. A full navigation changes
`documentId` and rejects queued work. The foreground document remains the
trusted event and feedback surface; selecting another Hotkey Target does not
create Capture admission. The isolated-world gesture channel carries default
visual phases plus live-only physical site-release identity to the full runtime.
It owns a cross-bundle monotonic sequence, retains only the bounded cold-start
default-phase queue until the lifecycle-bound subscriber mounts, and drains each
queued phase once. Page script therefore cannot forge control or feedback input,
the first cold-page Toast is not lost, a historical keyup cannot clear a new
site gesture, and an old completion cannot collide with a newer gesture.

Bootstrap restore, the first Popup snapshot, Popup/remote control and Chrome
commands also share one single-flight initialization barrier keyed by
`tabId + documentId`. Its restore decision first rebinds an acknowledged
same-origin tab session; only when none exists does it resolve the site/global
preset. A cross-origin identity removes the prior tab session. Restore-origin
coordinator writes bypass the barrier itself, preventing self-wait, while every
external control waits until restore has either completed or reported its one
structured failure. This prevents a cold preset replay from racing and
reverting the first explicit value above 100.

A non-empty session or preset restore retains one document-scoped settings
runtime lease. Restorable media fields are recorded as desired state even when
the document has not created a media element yet. Registration, metadata, play
and trusted selection then replay that same revision to the exact new source.
Navigation retires the lease. This makes SPA-delayed video creation part of the
restore lifecycle instead of treating an initial `No active media target` as
successful completion.

Runtime readiness does not imply Capture authority. Popup, `chrome.commands`,
the five built-in Bootstrap gestures, and configured page hotkeys share the
same Background invocation boundary only after their current top-level document
and active target are verified. If a shortcut targets a retained background
tab instead of the active tab, it keeps ordinary control routing but receives
no Capture admission.

There is one feedback owner per hotkey. The owner starts a standard Toast only
for a real shortcut/action intent, keeps the normal volume bar and timeout, and
cancels repeat work, unconsumed pulses, and Toast inertia on keyup. A shortcut
targeting another tab may project the same Toast visual style in the current tab
with an additional focus-tab label; refresh, bootstrap, Popup open and snapshot
synchronization never create a Toast.

Toast and acknowledged volume/speed OSD hosts use a manual Popover top-layer
surface rather than competing with site `z-index`. A `fullscreenchange`
reopens the connected host after the fullscreen element enters the top layer,
so fullscreen video cannot cover shortcut feedback. Speed feedback renders the
actual ACK (`0.9×`, `1.0×`, and so on). Every scalar bar uses one linear
normalization owner, so equal numeric deltas always occupy equal visual
distances and marker placement cannot drift from the fill. Volume marks `100%`;
speed marks both `1×` and `2×` on staggered label lanes. When a slow native ACK
coalesces several shortcut pulses, a held page binding advances a transient
feedback target once per trusted physical repeat from the latest acknowledged
baseline. The displayed number and fill interpolate from that same scalar value
at the shared one-step-per-50-ms cadence. Slower intermediate ACKs synchronize
the control owner but cannot rewind a same-region held-key projection. At the
`100↔>100` processor boundary, OSD retains the prior complete acknowledged
value and `AudioVolumeState`. Only the gesture-bound aggregate coordinator ACK,
never an internal target/processor stage callback, may commit the new value and
the shared `UIColors` blue/purple/gray tone atomically, exactly like Popup.
Same-tab and selected-target feedback carry the originating gesture identity;
an older or different gesture cannot repaint the foreground. Keyup freezes the
final frame, while hide and disposal conceal it immediately. The projection
never mutates configuration or survives release, so acknowledged state remains
the sole business owner without post-release inertia or color drift.

## §6 Exact-element page media, PiP and fullscreen

`volumeBase`, `mediaMuted`, and `speed` use the native order
`page-native -> dom-native`. The manifest-registered
`content-page-media-bridge.js` runs in MAIN with a V2 guard. An ISOLATED request
is encoded on the exact `HTMLMediaElement`, synchronously dispatched as one DOM
event, and synchronously answered on that same element. The bridge performs a
bounded composed-ancestor/property discovery for the requested field only. An
explicit media/root association outranks distance, distance outranks capability
count, and an unrelated outer player therefore cannot steal an inner media
field.

A page candidate is usable only when it exposes the paired getter/setter for the
requested semantic field and can truthfully apply the requested value. The
getter is the ACK; after a write it must return the requested value through a
bounded stable readback. Before field ownership is acquired, a synchronous or
delayed mismatch may fall through to the standard `HTMLMediaElement`
property/event candidate only after the same page writer proves that its
baseline is stable again. This capability admission is value-specific, so a
player UI capped at 2× or 3× cannot prevent standard `playbackRate` from
applying a higher supported value. An owned `page-native` writer never falls
back to DOM. A `dom-native` writer may mature to `page-native` only during a
later exact-source intent when a SPA player attached its controller after the
initial restore. The intent may be an explicit control or the one bounded
desired-state replay admitted by registration, metadata, play, or trusted
selection for that target/field/revision. That request-local transaction
captures the page baseline, proves the requested value through the page setter
and stable getter, then compare-and-swaps the exact prior DOM owner while
retaining the original release baseline. If page admission fails, the candidate
must first restore its page baseline and the executor must re-acknowledge the
prior DOM `lastApplied` value before DOM fallback continues; ownership remains
DOM and a later desired revision or unconsumed lifecycle boundary may retry
maturation. There is no timer, mutation-driven controller scan, reassert loop,
or `page-native -> dom-native` migration.

If an owned page getter later disappears, a passive event/startup observation
may fall back to the DOM getter so Content can still report actual state and
reach READY; this does not migrate ownership, and the next write remains bound
to the missing page writer and fails explicitly.

Native `volumechange`/`ratechange` events emitted while a SPECTRA write is
pending belong to that event/getter transaction. Matching events are ACK
evidence and transient mismatches remain transaction evidence; neither can
submit a competing page revision. After the transaction settles, ordinary page
events re-read the field's selected writer before committing the shared
snapshot.

Discovery is request-local: there is no hostname list, player selector,
controller cache, page-controller event subscription, descriptor patch,
reassert loop, timer, observer, or polling. The single document event listener
does no work between explicit requests.

PiP and fullscreen remain native lifecycle operations bound to the current
`activeVideo`. Trusted page hotkeys and the immediate Popup PiP path call the
same standard native executor while browser user activation is live; they do not
use MAIN. Popup PiP installs one request-local result-attribute observer before
synchronously dispatching the trusted trigger, and the same
`chrome.scripting.executeScript()` Promise returns that getter ACK. The
observer and timeout are disposed together; there is no follow-up injection or
Popup-side polling. The fullscreen V1 bridge wraps only the page's real
`requestFullscreen()` entry so an already-active enhanced-audio path can yield
and restore around that native transition. Its per-call listener/timer exists
only during the bounded handoff. PiP recovery targets the actual
`document.pictureInPictureElement`/owner media and commits only native
enter/leave event plus getter readback.

An acknowledged active Capture yields only through a document-local, one-shot
continuation: the stop ACK completes before fullscreen READY, the continuation
is invalidated by any intervening Capture generation/state change, and FINISH
may resume only when the same desired route still owns the handoff. Resumption
restores the acknowledged actual configuration before normal policy
reconciliation. It continues an already-authorized Capture; it is not a new
route admission and cannot be minted from bypass, starting, error or stale
state.
