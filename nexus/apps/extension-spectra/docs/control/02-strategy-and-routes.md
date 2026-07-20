---
type: reference
status: stable
audience: developer
---

# 02. Strategy order & Routes (Capability order, registry, runtime, adapters)

> 主题 owner 段: §3 Strategy order · §4 Site route registry · §5 Runtime ownership · §6 Site adapters, PiP & fullscreen
> 完整目录: [control-architecture.md](../control-architecture.md)

## §3 Strategy order

For each capability, the planner removes candidates that cannot cover the requested scope or cannot return actual readback, then follows that capability's own order. In this release the only official page-world adapter covers YouTube `volumeBase`, `mediaMuted` and `speed`, and it runs only after the corresponding standard DOM write/readback fails. No other capability may claim site-native support until its adapter and readback tests land with the contract entry.

```text
OBSERVE
  -> CAPABILITY-SPECIFIC NATIVE CANDIDATES
       (SITE_NATIVE / DOM_NATIVE / CHROME_NATIVE)
  -> CAPABILITY-AUDITED CONTROLLED AUGMENTATION
       (EXTENSION_STATE / CSS / OVERLAY / SAFE_MEDIA_WEBAUDIO / CAPTURE)
  -> UNSUPPORTED
```

`SITE_NATIVE` can use a document-scoped MAIN adapter when an official player object exists only in the page world and standard DOM control is incomplete. Current adapters are single-player `active-target` strategies and are never admitted for a `full` request. This is API adaptation, not permission for generic monkey-patching. There is no generic MAIN fallback.

### §3.1 Forbidden generic MAIN behavior

Production code must not replace or redefine:

- `window.AudioContext` or `webkitAudioContext`;
- an `AudioContext` instance's `destination` or `close`;
- `window.Audio`;
- `document.createElement` or `createElementNS`;
- `HTMLMediaElement` prototype descriptors;
- History API methods from an isolated-world runtime.

MAIN execution is limited to allowlisted site adapters loaded on demand by the background `MainRuntimeManager`.

### §3.2 Native, augmentation and forbidden hijack

The implementation must not hide invasive behavior under the word "native". Every selected strategy belongs to one of these classes:

| Class | Strategies | Meaning |
| --- | --- | --- |
| observe | `observe` | Read authoritative events/getters without acquiring control. |
| native | `site-native`, `dom-native`, `chrome-native` | Use an official site API or a browser-owned API/property with readback. |
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

## §6 Site adapters, PiP and fullscreen

Site playback-rate synchronization is a one-shot, site-scoped official API
adapter. The adapter is attempted only after the standard DOM writer/readback
fails, validates the current document and media identity, and accepts success
only from the site's getter or authoritative event. A page that exposes no
stable official API remains `unsupported`; the extension does not install a
generic page bridge or claim that every site's player UI can be synchronized.

PiP and fullscreen are native lifecycle operations bound to the current
`activeVideo`. The trusted page-event bridge performs the browser API call inside
the real activation stack, then commits only the observed native state. Leaving
fullscreen uses the temporary audio handoff solely to preserve the page's
volume/mute baseline while native fullscreen is entered; it restores that
baseline immediately after the transition and never uses a volume mutation as a
gesture substitute. PiP recovery targets the actual
`document.pictureInPictureElement`/owner media, so a site that moves its PiP
surface away from the visible page can still be returned through the native
leave-PiP lifecycle when the browser exposes it.
