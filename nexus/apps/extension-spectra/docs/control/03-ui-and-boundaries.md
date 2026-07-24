---
type: reference
status: stable
audience: developer
last_reviewed: 2026-07-24
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
is imported only after an explicit video enhancement intent. The Background
service worker is one self-contained ESM because it owns durable restore and
its runtime-loader/coordinator cycle must initialize atomically on every MV3
worker start. Popup, Options and offscreen are independent extension pages and
may share deterministic production chunks; those private chunks are not
web-accessible resources. Development builds stay standalone for readable
Chrome smoke diagnostics.

The contracts, audio-engine and kernel packages declare `sideEffects:false`.
They are pure runtime libraries: this lets production tree shaking remove
unused barrel exports instead of charging every extension context for protocol
families it cannot execute. The architecture checker requires those package
flags so a metadata edit cannot silently reintroduce duplicated control code.

`scripts/check-production-artifacts.mjs` computes each entry's complete static
and dynamic dependency closure and the Background + bootstrap startup closure,
requires the Background closure to contain only its own bundle, but does not
freeze historical byte ceilings. Its invariant is zero
avoidable production redundancy: every artifact must be reachable from the
manifest/HTML/CSS/module graph; byte-identical files, repeated modules within a
shareable build domain, bare or escaping imports, source/test/debug artifacts,
diagnostic calls and source-map references fail the build. Replication is
reported but allowed only across Chrome runtime domains that cannot share a
module instance. Current bytes and top module contributions remain measured
release evidence rather than an arbitrary product baseline.

Application bundles never enter a second Terser pass. SPECTRA values cross
storage, extension IPC, Chrome dictionaries, DOM, generated JSON, dynamic
imports and independently emitted execution worlds; neither a static allowlist
nor a second optimizer can prove that complete post-esbuild ABI. The single
esbuild production pass still performs syntax, whitespace and local-identifier
minification, while storage fields, protocol keys, computed access, ESM
namespace members and cross-context singleton properties retain one optimizer's
semantics without a feature-specific reserve list.

The only property-mangling boundary is the separately emitted opaque PeerJS
vendor IIFE, where the upstream library marks physically private properties
with `_`. Its public, signaling and WebRTC property names are never eligible.
The minification-policy unit test and extracted-ZIP Chrome smoke jointly prove
this post-bundle invariant, including refresh restoration from persisted
session fields.

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
- Crossing the native/processor volume boundary keeps the last complete acknowledged value-and-color pair visible until the compound operation ACK. The Popup then commits the new numeric value and processor color in one render: blue remains native/Media WebAudio actual state, purple still requires the matching active Capture ACK, and no third transition color or mismatched `110%`-blue frame is rendered. Same-region slider movement remains optimistic because it does not change processor ownership.
- Badge visibility owns a separate per-tab sticky usage fact in `chrome.storage.session`. A new tab with only page-native `0–100` observations remains blank. A successful Popup, Chrome-command, remote or non-audio extension action—and application of a configured site/global preset—starts the usage fact for that tab. Navigation and service-worker restart preserve the fact and last acknowledged state; because Chrome clears a tab-scoped Action projection during full navigation, Background waits for the new document initialization barrier and then reprojects the badge from the current `ControlSnapshot` plus acknowledged tab session after `tabs.onUpdated(status=complete)`. Tab close is the sole retirement boundary. Rendering requires the complete acknowledged `volumeBase + boost` pair. Until it exists the Badge is completely empty: no dot, gray background, text or other placeholder may reveal the internal usage fact.
- Toast and actual-value OSD share one manual-Popover top-layer host per feedback kind. Fullscreen changes re-promote connected hosts after the video enters the browser top layer; no site `z-index`, stacking context, or fullscreen element may cover shortcut feedback.
- Scalar page repeats retain only a bounded pulse count while an actual-readback transaction is active. The four holdable defaults (`Alt+ArrowLeft/Right/Down/Up`) are page-owned, so every trusted physical repeat advances one transient feedback target and exact keyup cancels both pending control work and visual motion. The label is the discrete target—volume remains integer `10`-point steps and speed remains exact `0.1×` steps—and commits in the input task so a busy animation frame cannot swallow an intermediate number; the fill alone interpolates in display frames. A held gesture retargets over the measured physical-repeat interval (bounded to `16–50 ms`) instead of restarting a duration multiplied by missed ACK steps, while every delivered frame is capped to the same `0.6` fraction of one semantic step for both scalar kinds. A skipped browser frame can therefore delay progress but cannot create a full-step visual jump or animation debt. Each gesture has a namespaced monotonic identity. Keyup conceals a repeated gesture immediately but retains its barrier until the sole in-flight operation settles; the release token is rechecked after runtime acquisition, so delayed work cannot start, resurrect motion, or release a newer gesture. Because Chrome commands expose no keyup, their manifest registry and configurable slots reject every `coalesce-20hz` action instead of approximating release with an idle timeout. This keeps native `0–100`, Boost and speed feedback on the same exact input timeline without post-release inertia.
- Scalar Toast ranges are linear rather than capability-specific visual guesses: volume is `0–800%` with a `100%` marker, and speed is `0.1–16×` with staggered `1×` and `2×` markers. The marker and fill percentages come from the same scale owner.
- Options derives command rows from the explicit `chrome.runtime.getManifest().commands` registry. It owns no parallel command-name list or row count, and Chromium's implicit `_execute_action` never becomes a configurable row.
