---
type: reference
status: stable
audience: developer
---

# 07. Runtime & Performance (Loading, ownership map, cross-world adapters)

> 主题 owner 段: §16 Runtime loading and performance · §17 Implementation ownership and migration map · §18 Cross-world site adapters
> 完整目录: [control-architecture.md](../control-architecture.md)

## §16 Runtime loading and performance

The manifest contains only a lightweight ISOLATED bootstrap. While idle it installs
only a versioned HELLO/message boundary and pagehide cleanup; it does not read
settings, scan media, create observers or write DOM markers. A passive
`spectra.control.actual.read` may run one bounded top-level media getter and one
bounded top-level video getter so first-open state does not collapse the two
targets, but it still does not persist state or acquire a runtime/processing
lease.

Heavy document runtime leases are limited to explicit control, restored non-default settings, an observation subscription, authenticated remote use or configured site hotkeys. Status reads never acquire a processing lease. The last lease releases every observer/listener when no controlled field remains.

Remote pairing creation does one passive actual projection through the same
bootstrap/registry read path and caches it in the existing offscreen session.
Caching does not acquire a processing lease and does not expose state before
authentication. After authentication, a remote observation lease keeps later
page events synchronized; disconnect or session destruction releases only that
consumer. Background modules call the coordinator's serialized functions
directly and must not route work back through `chrome.runtime.sendMessage` to
the originating Service Worker.

Once the heavy runtime already exists, `spectra.control.actual.read` resolves only
through the event-maintained `MediaRegistry` and pure controller getters. It does
not scan the document, install listeners, initialize an observed baseline, create
default video-owner state or change target selection. Event-correlation baselines
are initialized when the runtime acquires the existing registry and whenever a
new media/source is registered. The bounded bootstrap getter described above is
the sole scan exception and still has no write, subscription or persistent state.

`runtime-loader.ts` represents the document reference count as the size of a
`Set<reason:capability>`. Re-acquiring the same consumer token is idempotent;
releasing any one token cannot affect another; only deletion of the final
unique token schedules the acknowledged runtime disposer. The 250ms handoff
window permits Popup/remote/control ownership transfer without unload/reload
churn and is cancelled immediately by a new lease.

MAIN site-adapter leases are keyed by `tabId + documentId + generation + capability`. The background manager is the only production source allowed to execute MAIN code.

Default invariant:

```text
0 extension AudioContext
0 offscreen lease
0 MAIN runtime
0 media MutationObserver
0 recurring timer/rAF/IPC
```

The invariant above applies before the user explicitly acquires Media WebAudio.
After `createMediaElementSource()` succeeds, the browser owns an irreversible
page-lifetime binding: closing that context would make the element impossible to
rebind without risking silence. Release therefore switches the shared router to
a unity lane, removes every optional DSP/analyser node and stops extension IPC,
but retains the smallest source -> gain -> destination route until navigation.
Capture does not have this exception and releases its offscreen lease normally.

## §17 Implementation ownership and migration map

These locations are architectural owners, not suggestions. A future implementation must update this section before moving a responsibility.

| Location | Target responsibility | Purpose of the migration |
| --- | --- | --- |
| `packages/contracts/src/control.contracts.ts` | exhaustive fields/operations, strategy classes, intent/snapshot/ACK guards | Keep Popup, remote, content, background and tests on one semantic vocabulary. |
| `packages/contracts/src/spectra.bootstrap.ts`; `src/content/core/bootstrap.ts` | minimal always-on protocol constants, validators and passive read boundary | Prevent the complete v2 action/validator graph from becoming default-page parse cost while preserving strict runtime validation. |
| `packages/features/audio-engine/src/CapabilityPlanner.ts` | pure least-invasive per-capability selection | Make native/augmentation admission deterministic and unit-testable without browser side effects. |
| `src/background/control-coordinator.ts` | intent ordering, per-field revision, stable snapshot and rollback | Establish the only authority that commits actual state. |
| `src/background/runtime-loader.ts` | document-scoped heavy-runtime lease and READY handshake | Preserve the zero-work default and remove fixed injection sleeps. |
| `src/background/main-runtime-manager.ts` | one-shot allowlisted site API calls only | Delete the generic MAIN runtime while retaining the three implemented official page-world controls without a standing lease. |
| `src/content/core/bootstrap.ts` | lightweight HELLO/message/pagehide boundary plus bounded passive native getter | Keep idle injection side-effect-free while allowing first-open UI/remote actual state without installing the heavy registry. |
| `src/content/core/media-registry.ts` | `mediaId`, `sourceRevision`, cached visibility and sticky active target | Remove document scans/layout reads from command hot paths. |
| `src/content/logic/native-media-executor.ts` | sole DOM writer, registration-time event baseline and pure registry-backed readback | Replace concurrent `media-control.ts`, `dom-volume.ts` and bridge writes while preventing status reads from initializing mutable correlation state. |
| `src/content/core/media-registry.ts`; `src/background/control-coordinator.ts::handleTargetChanged` | explicit media/source selection synchronization | Commit a new active target only after a sender-bound one-shot actual readback confirms the same `mediaId + sourceRevision`. |
| `src/background/control-coordinator.ts::projectControlTarget`; Popup card/side-panel target selection | ACK target projection into independent active identities | Use the exhaustive contract scope to stop video, tab and document operations from stealing or clearing the unrelated media/video target. |
| `packages/contracts/src/control.contracts.ts::SITE_NATIVE_ADAPTER_DESCRIPTORS`; `src/background/main-runtime-manager.ts` | exact site-native capability allowlist and one-shot implementation | Ensure only implemented site APIs can follow a failed DOM attempt and no standing bridge can drift back in. |
| `packages/features/audio-engine/src/webaudio/*` | page-lifetime source registry and one lazy shared graph | Prove eligibility before irreversible binding and create only active nodes. |
| `src/content/video/video-effects-controller.ts` | media-keyed CSS/overlay owner with runtime-random selector token and pure snapshot | Restore the site's exact pre-existing attributes/custom properties, make a neutral never-owned write DOM-free, and prevent a site-authored `data-spectra-*` name from matching extension CSS. |
| `src/content/video/ab-loop.ts`; `time-marker.ts` | media/source-keyed A/B and marker algorithms with disposers | Prevent state leaking across source revisions, suppress skip re-entry, use a hidden-tab boundary timer and return actual seek readback for every marker jump. |
| `src/background/handlers/screenshot.ts`; `src/content/video/video-transform.ts` | token-bound target verification, visible-tab capture, crop and download-complete orchestration | Keep one Chrome-native writer, verify source/geometry on both sides of capture, avoid image IPC and expose structured capability failures. |
| `src/content/input/*`; `packages/contracts/src/hotkeys.contracts.ts` | translate hotkeys into typed coordinator intents and assign one feedback owner | Remove direct media writes, transport-specific capture toggles and duplicate success OSD/toasts. |
| `src/background/visualizer-subscriber-registry.ts`; `src/background/handlers/audio.ts` | generation-aware per-consumer analyser leases, heartbeat expiry and bounded tombstones | Preserve independent Popup consumers, reclaim abnormal exits and prevent delayed batches from reviving released analysers. |
| `src/popup/card/types.ts`; `src/popup/card/init.ts`; `src/popup/card/messaging.ts` | field projection from `ControlSnapshot`; lifecycle projection from `AudioSessionSnapshot` | Prevent two actual authorities and keep control/audio generation domains independent. |
| `src/background/control-coordinator.ts`; `src/background/handlers/user-scripts.ts` | source-window browser operations and document-bound sandbox execution | Prevent multi-window commands or navigation races from acknowledging work against another tab/document. |
| `packages/contracts/src/spectra.protocol.ts` | v2 control apply/get/subscribe wire definitions | Make all surfaces receive one snapshot and actual ACK shape. |
| `packages/contracts/src/spectra.ui-runtime.ts`; `spectra.ui-settings-runtime.ts`; `src/shared/ui-*-spectra-client.ts` | surface-specific UI protocol allowlists and runtime guards | Keep canonical validation while preventing the Options settings editor from loading Popup control ACK/snapshot and audio/remote validator code. |
| `scripts/verify-architecture.js` | `SCTRL-*` static enforcement | Turn this owner document into a release gate instead of advisory prose. |
| `build.mjs`; `scripts/check-production-artifacts.mjs` | isolated content artifacts, extension-origin shared ESM chunks and zero-redundancy production graph | Measure real entry/startup closures and reject unreachable, duplicate, debug, source/test or shareable repeated artifacts without freezing historical byte ceilings. |

### §17.1 Implementation status ledger

Every row is release-gated as landed. Reintroducing `partial` or `pending` is a
build failure; changing a status requires source and test evidence in the same
change.

| Status | Location | Concrete change and purpose |
| --- | --- | --- |
| landed | deleted `src/injector/*`; manifest/build; `src/background/main-runtime-manager.ts` | Remove generic constructor/descriptor/element interception and default MAIN cost. A failed DOM readback may invoke the allowlisted YouTube official setter/getter once through privileged `executeScript`; a bounded quiet window and stable getter complete the ACK, and no adapter bundle or page listener remains. |
| landed | `packages/features/audio-engine/src/AudioGraphRouter.ts`; `webaudio/controller.ts`; `offscreen/audio-host.ts` | Share one sparse graph, require prospective and actual full-registry coverage before Media WebAudio ACK, reconnect rather than recreate page-lifetime sources, provide normalized graph/Capture readback and preserve the stable processor during candidate failure. The contract records the minimal unity route that must remain after an irreversible media binding. |
| landed | `src/content/core/bootstrap.ts`, `background/runtime-loader.ts`, `content/core/media-registry.ts` | Keep default pages bootstrap-only and make the optional runtime/document target identity explicit. |
| landed | `packages/contracts/src/spectra.bootstrap.ts`; `build.mjs`; `scripts/check-production-artifacts.mjs` | Reduce the always-on content boundary to the four required message families, share production code only between extension-origin module contexts, measure every real closure and reject all avoidable production redundancy. |
| landed | `build.mjs`; `scripts/external-boundary-properties.mjs`; `src/offscreen-remote/peerjs-vendor.ts`; `test/release-tooling.spec.ts`; production Chrome smoke | Preserve Chrome/browser dictionaries, transport payload keys, dynamic ESM exports and versioned singleton members before property mangling. Build PeerJS as an opaque local vendor artifact whose public/signaling/WebRTC ABI is never application-mangled; only its underscore-prefixed private members may be shortened. This prevents production-only loss of `currentWindow`, Capture constraints, remote HMAC proof and cross-injection runtime methods while keeping SPECTRA-owned properties optimized. |
| landed | `src/content/logic/native-media-executor.ts`; `scripts/verify/check-spectra-control.js` | Centralize the only direct standard-media property assignments, including volume, mute, speed, pitch preservation, seek and loop; make a second direct property writer a release error. |
| landed | `src/content/core/media-registry.ts`; `src/content/logic/native-media-executor.ts`; `src/background/control-coordinator.ts` page-observation path | Commit verified page-side volume, mute, speed, pitch, transport, seek, loop, PiP and fullscreen facts to the shared snapshot without echoing a second DOM write; reuse events/one existing observer and add no polling. |
| landed | `src/content/audio/media-detection.ts`; `content/core/lifecycle/media-observer.ts`; `content/utils/pause-tracker.ts`; `content/logic/native-media-executor.ts` | Make status/read paths pure registry projections: no listener installation, DOM fallback, synthetic registry event or read-triggered correlation state. Pause retention is updated only by registry events. |
| landed | `src/content/video/video-effects-controller.ts`; `video-transform.ts` | Own reversible attributes/variables and a closed-shadow dim overlay without overwriting site inline transform/filter/layout values; a neutral value on a never-owned video is a DOM-free no-op. Keep `video-transform.ts` screenshot-only and remove the duplicate `video-filter.ts` facade. |
| landed | `src/content/video/video-effects-controller.ts`; `test/video-effects-controller.spec.ts` | Scope CSS selectors with a runtime-random owner token, capture the site's attribute/custom-property values, keep neutral dim writes from deleting site state and separate stylesheet lifetime from generic effect state. |
| landed | `packages/contracts/src/control.contracts.ts`; `src/background/control-coordinator.ts`; `src/content/core/media-registry.ts`; `src/popup/side-panel/video-controls.ts` | Keep `activeMedia` and `activeVideo` as separate actual identities. Audio/transport and video-only controls no longer steal or misroute one another's target, while all surfaces still submit typed mutations or operations to the serialized coordinator. |
| landed | deleted `src/content/logic/media-control.ts`, `media-message-handler.ts`, `audio/dom-volume.ts`, `audio/volume-observer.ts`; `logic/mode-executor.ts` | Retire competing media writers. The remaining audio-topology compatibility layer delegates native fields to the canonical executor and cannot write volume, mute, speed, seek, pitch or loop. |
| landed | `scripts/verify/check-spectra-control.js`; `src/content/logic/native-media-executor.ts` | Enforce one direct writer module, forbid indirect legacy writer imports/calls and fail when generic MAIN, raw cross-world messages or retired control modules return. |
| landed | deleted `src/content/logic/site-bridge/*` and `src/injector/*`; `background/main-runtime-manager.ts` | Replace raw page messages, echo caches and permanent listeners with one allowlisted official setter/getter invocation whose result is returned directly by Chrome. |
| landed | `src/content/video/ab-loop.ts`; `time-marker.ts` | Bind A/B and markers to `mediaId + sourceRevision`, use one bounded A/B scheduler, binary marker lookup and the unique acknowledged seek executor. |
| landed | `src/content/input/hotkey-actions.ts`; `hotkey-helpers.ts`; `hotkey-listener.ts`; `background/shortcuts.ts` | Translate every enabled shortcut through its exhaustive descriptor into a typed coordinator intent/operation; preserve repeat/coalescing and activation rules without direct media writes. |
| landed | `src/background/remote-commands.ts`; `remote-service.ts`; `offscreen-remote/remote-host.ts`; Popup card/side-panel modules | Remote and extension UI submit canonical coordinator mutations, consume snapshot pushes, reject stale generations/revisions and roll optimistic rendering back to the latest stable actual snapshot. Background uses a direct serialized coordinator gateway rather than unreliable worker self-RPC; create/restore privately seeds actual state so HMAC success can deliver the first projection immediately. Popup fields initialize from `ControlSnapshot` only; `AudioSessionSnapshot` owns processor lifecycle only. |
| landed | `src/background/visualizer-subscriber-registry.ts`; standard-media/offscreen subscription; Popup shared scheduler | Hold independent generation-aware analyser leases only while visible cards consume them, expire abnormal exits after 5 seconds, retain bounded anti-resurrection tombstones, reuse one analyser per active processor and keep sampling batched at 15 Hz. |
| landed | `packages/contracts/src/hotkeys.contracts.ts`; `src/content/input/hotkey-listener.ts` | Assign every action exactly one feedback owner so acknowledged actual OSD, semantic handler results and generic labels never overlap. |
| landed | `src/content/video/video-transform.ts`; `src/background/handlers/screenshot.ts`; `spectra.protocol.ts` | Bind screenshot capture to a random token and verify the same document/source/geometry before and after `captureVisibleTab`, then ACK only after download completion. |
| landed | `packages/contracts/src/audio.contracts.ts`; `packages/features/audio-engine/src/AudioGraphRouter.ts`; Capture/WebAudio readback adapters | Encode processor level only as `boostGain: 1–8` and remove processor mute. This makes the native page volume/mute writer boundary structural rather than relying on callers to force an unused DSP mute field off. |

The static checker enforces direct and indirect writer ownership, forbidden
generic MAIN behavior, the one-shot allowlist boundary, 51-row strategy parity
and a fully landed ledger. Release promotion also runs integration coverage for
the cross-surface synchronization path.

## §18 Cross-world site adapters

Adapter descriptors report per field:

```text
observe / write / coverage / readback / ready-state
```

An official API setter is followed by its official getter or authoritative event. Site API and DOM are never simultaneous writers for one field.

There is no standing adapter bridge or page `postMessage` channel. Background performs one allowlisted `executeScript` call for the exact field, validates document/generation/intent identity around the call, and accepts only the official getter value returned directly by Chrome. A stale document or unsupported official API fails closed.
