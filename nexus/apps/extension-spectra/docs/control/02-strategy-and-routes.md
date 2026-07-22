---
type: reference
status: stable
audience: developer
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
insufficient and a full-output processor is explicitly needed. A cached route is
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

The escalation is activation-bound: it requires `hasUserGesture(state)` and
follows SCTRL-011 — the processor handoff never double-applies DSP, never ACKs
before actual readback, and a candidate failure leaves the prior stable
configuration in `bypass+error` with the capture denial surfaced as `lastError`.
A transparent configuration (no boost, no DSP) never escalates, because a
coverage gap without a processor need is reported directly through the bypass
path and does not justify the activation-bound Capture lease.

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

There is one feedback owner per hotkey. The owner starts a standard Toast only
for a real shortcut/action intent, keeps the normal volume bar and timeout, and
cancels repeat work, pending timers, and Toast inertia on keyup. A shortcut
targeting another tab may project the same Toast visual style in the current tab
with an additional focus-tab label; refresh, bootstrap, Popup open and snapshot
synchronization never create a Toast.

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
requested semantic field. The getter is the ACK; after a write it must return the
requested value through a bounded stable readback or the same page writer
restores its baseline and fails. Once SPECTRA owns a field through
`page-native`, that field cannot silently switch to the DOM writer until
ownership is released. When no page candidate exists before acquisition, the
standard `HTMLMediaElement` property/event path remains the general fallback.
Page-originated `volumechange`/`ratechange` events re-read the semantic page
getter before committing the shared snapshot.

Discovery is request-local: there is no hostname list, player selector,
controller cache, page-controller event subscription, descriptor patch,
reassert loop, timer, observer, or polling. The single document event listener
does no work between explicit requests.

PiP and fullscreen remain native lifecycle operations bound to the current
`activeVideo`. Trusted page hotkeys and the immediate Popup PiP path call the
same standard native executor while browser user activation is live; they do not
use MAIN. The fullscreen V1 bridge wraps only the page's real
`requestFullscreen()` entry so an already-active enhanced-audio path can yield
and restore around that native transition. Its per-call listener/timer exists
only during the bounded handoff. PiP recovery targets the actual
`document.pictureInPictureElement`/owner media and commits only native
enter/leave event plus getter readback.
