---
type: reference
status: stable
audience: developer
---

# 08. Invariants & Gates (SCTRL-001..044 and migration gate)

> 主题 owner 段: §20 Static invariants · §21 Migration and release gate
> 完整目录: [control-architecture.md](../control-architecture.md)

## §20 Static invariants

- `SCTRL-001`: untouched pages preserve native audio/media constructor and descriptor identity outside the explicitly allowlisted fullscreen method wrapper, and have zero processing or periodic work.
- `SCTRL-002`: planning is per field; no page-wide mode owns unrelated controls.
- `SCTRL-003`: one writer exists for each `{document, media, field}`.
- `SCTRL-004`: generic MAIN monkey-patching is forbidden; fullscreen V1 (`content-fullscreen-bridge.js`) and exact-element page-media V2 (`content-page-media-bridge.js`) are the only allowlisted manifest entries at `document_start`, and `main-runtime-manager.ts` remains the sole owner of the `world: 'MAIN'` re-injection literal for warm-update and on-demand paths.
- `SCTRL-005`: only readback actual state may be acknowledged; settings and refresh-session success cannot resolve before the corresponding physical Chrome storage write.
- `SCTRL-006`: intent and ACK identity includes document, generation, revision and intent ID.
- `SCTRL-007`: 100% and 1x are literal controlled values.
- `SCTRL-008`: MediaElementSource eligibility is proven before irreversible binding.
- `SCTRL-009`: extension CSS removal restores the site's current cascade; dim-target handoff releases only dim ownership and preserves independent effects on the previous video.
- `SCTRL-010`: transport/video state is bound to media ID and source revision.
- `SCTRL-011`: Capture is last-resort; processor handoff never double-applies DSP, never ACKs before actual readback and restores the last stable configuration after candidate failure.
- `SCTRL-012`: status and observation reads do not write settings, badge, page state or activate processing; same-document handoff hydration never replays policy for bypass, Media WebAudio or Capture, and session hydration of acknowledged Capture reconstructs ownership without changing its processor.
- `SCTRL-013`: neutral DSP and unsubscribed analysis create no nodes.
- `SCTRL-014`: page, Popup, remote, hotkeys and badge project one snapshot; Badge renders no placeholder before the complete acknowledged volume pair exists.
- `SCTRL-015`: MAIN cannot bypass user activation, CORS, DRM or inaccessible media.
- `SCTRL-016`: product UX exposes outcomes, not implementation modes.
- `SCTRL-017`: a page-native observation commits actual state once and never echoes a second write.
- `SCTRL-018`: top-level-only scope is explicit; passive bootstrap readback is bounded, while its only subscriptions are capture-phase volume/rate events with one in-flight plus one latest patch, initialization-first ordering and immediate heavy-runtime handoff.
- `SCTRL-019`: one visualizer IPC owns the next schedule; a slow request cannot create an empty 15 Hz wake-up loop.
- `SCTRL-020`: Popup fields project only `ControlSnapshot`; audio session data owns lifecycle only.
- `SCTRL-021`: visualizer ownership is per subscriber, expires abnormal exits and retains a bounded generation tombstone.
- `SCTRL-022`: every hotkey has exactly one feedback owner on a fullscreen-safe browser top-layer surface; scalar repeat bursts are bounded, only a new physical event consumes accumulated pulses, and key release/lifecycle disposal cannot leave a trailing invocation.
- `SCTRL-023`: screenshot source and geometry are token-verified on both sides of browser capture.
- `SCTRL-024`: document runtime ownership counts unique consumer tokens; only the last token may dispose it.
- `SCTRL-025`: `activeMedia` and `activeVideo` are independent actual identities; every video-only surface routes to the latter.
- `SCTRL-026`: a neutral CSS value on a never-owned target is a DOM-free no-op and cannot acquire or delete owner state.
- `SCTRL-027`: a native ACK is one-shot: DOM writers require their native event plus a bounded quiet window/stable getter, while page-native requires the exact controller getter to remain stable; requested setter return values are never ACKs.
- `SCTRL-028`: default pages have zero audio work; after explicit irreversible Media WebAudio binding only the minimal unity route may survive until navigation.
- `SCTRL-029`: an ACK target is projected only through its contract scope; video-only and tab/document operations cannot overwrite or clear the unrelated active identity.
- `SCTRL-030`: runtime status/read is a pure projection: it installs no listener, performs no document scan, changes no selection/correlation/owner state and emits no synthetic event; only the bounded bootstrap getter may scan before runtime acquisition, and bootstrap event observation never selects a target or writes storage directly.
- `SCTRL-031`: extension-UI, tab, sandbox and document-scoped operations that execute no media writer acknowledge `target:null`; they cannot borrow the currently active media identity.
- `SCTRL-032`: processor configuration exposes only `boostGain: 1–8`; page volume, media mute and a zero-gain mute substitute cannot cross the WebAudio/Capture boundary.
- `SCTRL-033`: Background control consumers invoke the serialized coordinator directly; MV3 worker self-RPC is forbidden, and remote state is cached privately before authentication then exposed only after HMAC success.
- `SCTRL-034`: the default content bootstrap uses only the minimal bootstrap contract; the MV3 Background worker is one self-contained ESM, production extension pages may share private ESM chunks, and artifact integrity measures transitive entry/default-startup closures while rejecting unreachable or avoidably duplicated output. Development output and the extracted production ZIP run the same Chrome integration source.
- `SCTRL-035`: native event-driven writes install their bounded listener before the setter and cannot ACK until the event/quiet/stabilized getter boundary completes.
- `SCTRL-036`: strategy escalation consumes only canonical typed failure codes; activation, permission, stale identity, CORS and protected-content failures are terminal.
- `SCTRL-037`: processor actual state comes only from normalized graph/host readback (`graphSignature`, actual config, source count and context state), never from desired input echo.
- `SCTRL-038`: WebAudio/Capture transitions neutralize the old DSP, verify the candidate actual path and only then release; failure restores the previous stable route.
- `SCTRL-039`: visible Popup and authenticated remote synchronization requires independent document observation tokens; ordinary status reads acquire none.
- `SCTRL-040`: successful per-media desired replay is separate from page observation; target-bound events never become per-media desired templates, while the targetless bootstrap may project only the four declared native configuration fields into the same-tab refresh session. The durable same-tab session wins first, then the most-specific site preset, then the selected default global preset.
- `SCTRL-041`: trusted page activation admits only page-stack APIs and Media WebAudio; new Capture requires a volatile Background admission minted for one current-active-tab Popup or `chrome.commands` transaction, external submit payloads cannot carry it, and restore/remote/page/alternate-tab paths never call `getMediaStreamId()` without it.
- `SCTRL-042`: video enhancement implementation is a lazy capability-owned module; native-only/default control does not load or instantiate it.
- `SCTRL-043`: Popup, Options and remote use a restricted protocol validator and cannot import or execute the Background request router.
- `SCTRL-044`: production application bundles have one esbuild optimization pass because storage, protocol, Chrome, DOM, JSON, computed and cross-world ABI behavior cannot be proven across a second minifier. Only the isolated PeerJS vendor artifact enters Terser, where private underscore-prefixed properties alone may be property-mangled.

## §21 Migration and release gate

The migration order is contracts/coordinator, runtime loaders, unique native writer, exact-element page bridge, per-field planner, safe audio graph, media/video executors, UI projection, then removal of old compatibility code. The static checker becomes mandatory before the old path is removed from the release branch.

Chrome integration must prove constructor/descriptor identity outside the
allowlisted fullscreen wrapper, exact-element page-controller selection,
ordinary DOM fallback, side-effect-free reads, one writer per field, actual ACK
ordering, page-to-Popup/remote/hotkey synchronization, automatic return from
Boost to native control at or below 100, safe CORS decisions, source uniqueness,
user-activation errors, CSS restoration, no hidden visualizer IPC and clean
disposal after navigation/update.

The gate must also stop/reacquire the MV3 worker before a same-origin refresh,
verify all `CONTROL_SESSION_FIELDS` remain in the durable projection, prove
built-in `Alt+ArrowLeft/Right` speed deltas without history navigation,
preset precedence and global fallback on new tabs, assert an empty Badge for
sparse/non-volume state, and exercise bounded scalar repeats plus release
cancellation. The same `smoke.spec.ts` source runs against the development
directory and the extracted production ZIP; changing build mode cannot silently
remove a lifecycle scenario.
