---
type: reference
status: stable
audience: developer
last_reviewed: 2026-07-23
---

# 03. UI & Boundaries (Visualizer, favicon, remote, UX)

> 主题 owner 段: §7 UI, visualizer, favicon and remote boundaries · §19 User experience
> 完整目录: [control-architecture.md](../control-architecture.md)

## §7 UI, visualizer, favicon and remote boundaries

All Popup/Options/remote labels, tooltips, state transitions and reset actions
use the canonical locale key table. Missing keys produce an observable fallback
and a contract-test failure, never `undefined`. Reset writes literal `volume=1`
and `rate=1`; restoring page-owned values is a separate explicit operation.

The visualizer is a subscriber of an already active processor. It owns one
generation-aware lease, one in-flight sample batch and a bounded sampling loop;
it does not create an analyser or processor merely because a Popup is visible.

Favicon lookup uses a browser-supported URL/service or a page-declared icon and
handles failure as a normal projection error. `_favicon` is not a manifest
permission. Remote QR images are generated and validated as complete local
`data:`/SVG URLs before rendering; invalid URLs and missing controllable origins
remain structured boundary errors.

### §7.1 Strategy admission and performance gates

`CONTROL_STRATEGY_RULES` is the executable owner of these gates. A strategy is not admitted merely because a setter exists.

| Strategy | Required proof before selection | Idle/runtime cost | Disallowed escalation |
| --- | --- | --- | --- |
| `observe` | authoritative getter/event, or an explicit subscription to an already-active processor | zero; subscription uses the existing processor only | must not create a content runtime, AudioContext, offscreen lease or MAIN code on a read |
| `dom-native` | standard per-element property/method, target identity, bounded event/getter readback | write/event only | no prototype/descriptor patch and no user-activation workaround |
| `chrome-native` | Chrome API supports the exact scope and a Chrome getter/event confirms actual state | command/event only | no optimistic response before `tabs.get`, native event or operation result |
| `extension-state` | data belongs to SPECTRA and is keyed to document/media/source as required | zero while unowned; event/timer only while owned | cannot masquerade as page-native state |
| `extension-css` | extension-owned attribute/variable, computed-style readback and removal disposer | zero while neutral | cannot overwrite or restore guessed site inline styles |
| `extension-overlay` | extension-owned shadow host, geometry readback and complete disposer | one coalesced rAF only while visible/owned | cannot change the target's position/z-index or synthesize focus/hover |
| `media-webaudio` | every required source is proven eligible before irreversible binding, requested coverage is complete and graph actual state is readable | one lazy document context; only active DSP nodes | unknown CORS, silence, DRM or inaccessible media are not probeable fallbacks |
| `capture` | explicit intent, permission/activation, current-generation offscreen candidate and normalized processor ACK | one lazy offscreen processor while leased | cannot activate from a status read or replace a stable path before candidate commit |
| `unsupported` | every less-invasive complete strategy failed its admission gate | zero | preserve the page and return a structured error |

### §7.2 Production loading topology and bundle ownership

Control completeness must not turn into default-page cost. The manifest loads
only `content-bootstrap.js`; its runtime imports come exclusively from
`@nexus/contracts/bootstrap`, a minimal protocol boundary that validates HELLO,
status, passive native read and release messages. It must not import the full
request map, the generic RPC client, the media registry or any control/DSP
executor. A target-bound or augmentation read returns
`content_runtime_not_loaded`, so Background acquires `content-runtime.js`
through the document lease/READY transaction instead of widening a passive
getter.

`build.mjs` keeps the bootstrap, main Content runtime and video-enhancement
Content artifacts isolated because Chrome injects them into page-specific
isolated worlds. The video artifact is a dynamic-URL web-accessible module but
is imported only after an explicit video enhancement intent. Background,
Popup, Options and offscreen are extension-origin ES modules and may share
deterministic production chunks; those private chunks are not web-accessible
resources. Development builds stay standalone for readable Chrome smoke
diagnostics.

The contracts, audio-engine and kernel packages declare `sideEffects:false`.
They are pure runtime libraries: this lets production tree shaking remove
unused barrel exports instead of charging every extension context for protocol
families it cannot execute. The architecture checker requires those package
flags so a metadata edit cannot silently reintroduce duplicated control code.

`scripts/check-production-artifacts.mjs` computes each entry's complete static
and dynamic dependency closure and the Background + bootstrap startup closure,
but it does not freeze historical byte ceilings. Its invariant is zero
avoidable production redundancy: every artifact must be reachable from the
manifest/HTML/CSS/module graph; byte-identical files, repeated modules within a
shareable build domain, bare or escaping imports, source/test/debug artifacts,
diagnostic calls and source-map references fail the build. Replication is
reported but allowed only across Chrome runtime domains that cannot share a
module instance. Current bytes and top module contributions remain measured
release evidence rather than an arbitrary product baseline.

Production property mangling is restricted by external ownership. Chrome API
dictionary keys, every emitted ESM export name and every versioned `__SPECTRA_*__`
cross-context singleton key are reserved before Terser processes the separate
files. Internal names may still shrink, but a caller chunk, Chrome API, injected
script or upgrade probe can never observe a renamed boundary key. The extracted
ZIP smoke is the executable proof for this post-bundle invariant.

The reserved set is derived from the complete emitted boundary rather than a
feature-specific repair list: every key in browser-loaded JSON (including
Manifest command identifiers), every generated locale-catalog section/key and
every statically accessed `dataset.*` name is preserved automatically. Thus a
new command, `data-i18n-*` binding or locale field cannot become `undefined`
only in the production bundle merely because its JavaScript property spelling
was mangled.

Computed runtime access is covered by the same derived rule. Every
identifier-shaped string literal emitted into a bundle is reserved before
property mangling, so an object key and a later access such as `stages[stage]`
cannot be renamed independently. Non-identifier strings are outside Terser's
property-mangling namespace. Release-tooling tests own both derivations; adding
a new dynamic key must not require another handwritten allowlist.

### §7.3 Failure-directed escalation

Escalation is decided from the failure of the attempted capability, never from
the hostname, a silent analyser, a timeout alone, or the page-wide audio mode.
The executable owner is `CONTROL_RETRYABLE_STRATEGY_FAILURES` /
`CONTROL_TERMINAL_STRATEGY_FAILURES` in `control.contracts.ts`.

| Failure class | Codes | Decision |
| --- | --- | --- |
| capability gap | `capability-unavailable`, `write-unsupported`, `readback-mismatch`, `coverage-incomplete`, `source-binding-ineligible`, `strategy-runtime-failed` | Dispose or bypass the failed candidate and try only the next strategy listed for that capability. |
| browser/security boundary | `user-activation-required`, `permission-denied`, `cors-or-drm-protected`, `protected-content`, `closed-shadow-inaccessible`, `stale-document`, `stale-media-source`, `policy-denied` | Stop. Return a structured error and preserve the stable path. MAIN or Capture must not disguise the boundary. |

The retryable flag in a wire error is descriptive; it cannot grant a strategy
that the capability policy does not list. Capture is not a fallback for
activation, permission, DRM or stale-target failures.

No strategy may bypass transient user activation, CORS, DRM or inaccessible closed-shadow media. `CONTROL_STRATEGY_RULES` fixes both flags to `false` for every current and future strategy.

## §19 User experience

- Main controls show page volume, media mute, speed, playback and target media.
- Boost and advanced DSP are separate controls.
- Multiple-media pages use independent sticky media and video targets based on trusted interaction, playback and cached visibility. The current release does not claim a manual target selector; an active audio element no longer disables or receives video-only controls when an eligible video remains selected.
- Actual state updates every open Popup and authenticated remote controller through snapshot push; remote commands do not immediately pull potentially stale state.
- Capture selection is automatic. Legacy `capture_toggle` bindings move to disabled diagnostics rather than exposing a transport implementation as a product feature.
- Errors rollback optimistic UI to the last stable snapshot and explain the missing capability without technical mode choices.
- Route/source pills remain readable at a minimum computed `11px`; Global and Site preset section titles remain high-contrast headings at a minimum computed `13px`. Their visible text and search placeholders always come from the validated locale catalog.
- Crossing the native/processor volume boundary renders amber only while desired and actual differ; amber never means “volume is above 100” and cannot be a stable mode. Purple appears directly from the matching Capture ACK, blue remains native/Media WebAudio actual state, and the fill has no color interpolation that can fabricate a blue-before-purple frame.
- Badge visibility owns a separate per-tab sticky usage fact in `chrome.storage.session`. A new tab with only page-native `0–100` observations remains blank. A successful Popup, Chrome-command, remote or non-audio extension action—and application of a configured site/global preset—starts the badge for that tab. Navigation and service-worker restart preserve both usage and the last truthful visible projection until the new document's ACK replaces it; tab close is the sole retirement boundary. A numeric badge requires the complete acknowledged `volumeBase + boost` pair; until that pair exists, a neutral dot reports usage without filling an unknown volume from defaults or inventing Capture state.
