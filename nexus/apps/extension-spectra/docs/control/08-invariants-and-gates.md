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
- `SCTRL-022`: every hotkey has exactly one feedback owner on a fullscreen-safe browser top-layer surface. The `document_start` Bootstrap uniquely owns all five shipped defaults (`Alt+Left/Right`, `Alt+Down/Up`, `Alt+M`); the heavy site listener excludes the same resolver result. Its shared arbiter uses permanent `window` capture only to recognize a candidate and append a temporary bubble tail for that same event. Website target/document/pre-existing `window` listeners run first; `defaultPrevented`, `cancelBubble`, and any propagation truncation that makes the tail unreachable yield to the website. Admission calls only `preventDefault()` and never stops propagation. `setTimeout(0)` may only remove an unreachable tail and reject it; microtask cleanup is forbidden. Closed-shadow editable identity hidden by retargeting and a same-dispatch `window` listener added after the tail are explicit platform limits. Mute repeat cannot toggle twice. The five defaults are absent from Manifest/default Chrome command slots. The four holdable scalar defaults have one page gesture identity, discrete per-pulse labels and cadence-bounded fill interpolation. The first Bootstrap's stable trusted-keyup observer survives revision subscriber handoff, emits only live site-release identity and never mutates the website event. Repeat state and in-flight work are gesture-keyed; only a new physical repeat consumes a bounded pulse batch, while keyup and lifecycle exits clear the remainder. No action timer or completion may self-drain a trailing writer or create post-release motion, and a new non-repeat press retires any same-code stale gesture without being blocked by its old completion. Only the matching aggregate shortcut result may release an OSD processor-boundary barrier; Popup, OSD and Badge share acknowledged `AudioVolumeState` color semantics. Chrome commands and configurable command slots reject coalescing actions because their API has no physical keyup.
- `SCTRL-023`: screenshot source and geometry are token-verified on both sides of browser capture.
- `SCTRL-024`: document runtime ownership counts unique consumer tokens; only the last token may dispose it.
- `SCTRL-025`: `activeMedia` and `activeVideo` are independent actual identities; every video-only surface routes to the latter.
- `SCTRL-026`: a neutral CSS value on a never-owned target is a DOM-free no-op and cannot acquire or delete owner state.
- `SCTRL-027`: native candidate admission and ACK are one-shot: before ownership a failed page candidate may admit DOM only after proving its own stable baseline restoration; DOM writers require their native event plus a bounded quiet window/stable getter; an exact-source explicit write or one bounded lifecycle replay may compare-and-swap only the exact `dom-native` owner to an acknowledged `page-native` writer while preserving the original release baseline, and a rejected maturation must restore both the page candidate baseline and prior DOM `lastApplied` state; `page-native` never migrates to DOM, in-flight native events cannot create a competing revision, and requested setter return values are never ACKs.
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
- `SCTRL-040`: successful per-media desired replay is separate from page observation; target-bound events never become per-media desired templates. Registration seeds viewport geometry before asynchronous visibility delivery, and registration/metadata/play/trusted selection may each reconcile only their exact source from the current extension-desired revision. The targetless bootstrap may project only the four declared native configuration fields into the current-resource part of the same-tab refresh session. A new document at the exact canonical URL may inherit that complete patch; another same-origin resource inherits only fields last acknowledged from explicit extension intent. A page observation removes its fields from that portable patch so an older extension value cannot reappear. The durable retained projection wins first, then the most-specific site preset, then the selected default global preset.
- `SCTRL-041`: new Capture requires a volatile Background admission minted for one current-active-tab Popup or identity-validated shortcut transaction. A page shortcut must match the current top-level HTTP(S) sender and exact document; external submit payloads cannot carry admission, and restore/remote/arbitrary page state/alternate-tab paths never call `getMediaStreamId()` without it.
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

The gate must also stop/reacquire the MV3 worker before an exact-resource
same-origin refresh, verify all `CONTROL_SESSION_FIELDS` remain in the durable
projection, prove that a muted recommendation/list resource is not replayed
into a different same-origin detail resource while explicit extension intent
is preserved, and prove the
five Bootstrap-owned defaults (`Alt+ArrowLeft/Right` speed,
`Alt+ArrowDown/Up` volume, and one-toggle-per-press `Alt+M` mute) without history
navigation, duplicate site-listener consumption, propagation suppression, or a
competing Manifest/default Chrome command slot. It must also prove the
shared arbiter's capture recognizer creates only a same-event bubble tail,
yields on `defaultPrevented`, `cancelBubble`, or an unreachable propagation path,
uses `setTimeout(0)` only for rejecting cleanup without a microtask, and calls
only `preventDefault()` after accepting an unclaimed chord. The gate records
closed-shadow editable retargeting and same-dispatch dynamically added `window`
listeners as platform boundaries rather than promises. It also proves rejection
of every coalescing action from configurable Chrome command slots,
preset precedence and global fallback on new tabs, assert an empty Badge for
sparse/non-volume state, and exercise bounded scalar repeats plus release
cancellation. The same `smoke.spec.ts` source runs against the development
directory and the extracted production ZIP; changing build mode cannot silently
remove a lifecycle scenario.
