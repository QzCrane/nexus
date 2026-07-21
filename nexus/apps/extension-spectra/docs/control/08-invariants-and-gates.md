---
type: reference
status: stable
audience: developer
---

# 08. Invariants & Gates (SCTRL-001..044 and migration gate)

> 主题 owner 段: §20 Static invariants · §21 Migration and release gate
> 完整目录: [control-architecture.md](../control-architecture.md)

## §20 Static invariants

- `SCTRL-001`: untouched pages preserve native constructor and descriptor identity and have zero processing work.
- `SCTRL-002`: planning is per field; no page-wide mode owns unrelated controls.
- `SCTRL-003`: one writer exists for each `{document, media, field}`.
- `SCTRL-004`: generic MAIN monkey-patching is forbidden; the three V1-guarded MAIN bridges (`content-fullscreen-bridge.js`, `content-playback-rate-bridge.js`, `content-youtube-volume-bridge.js`) are the only allowlisted manifest entries at `document_start` — the first two match `<all_urls>`, the third is YouTube-scoped (`*://*.youtube.com/*`) — and `main-runtime-manager.ts` remains the sole owner of the `world: 'MAIN'` re-injection literal for warm-update and on-demand paths.
- `SCTRL-005`: only readback actual state may be acknowledged.
- `SCTRL-006`: intent and ACK identity includes document, generation, revision and intent ID.
- `SCTRL-007`: 100% and 1x are literal controlled values.
- `SCTRL-008`: MediaElementSource eligibility is proven before irreversible binding.
- `SCTRL-009`: extension CSS removal restores the site's current cascade; dim-target handoff releases only dim ownership and preserves independent effects on the previous video.
- `SCTRL-010`: transport/video state is bound to media ID and source revision.
- `SCTRL-011`: Capture is last-resort; processor handoff never double-applies DSP, never ACKs before actual readback and restores the last stable configuration after candidate failure.
- `SCTRL-012`: status reads do not write settings, badge, page state or activate processing.
- `SCTRL-013`: neutral DSP and unsubscribed analysis create no nodes.
- `SCTRL-014`: page, Popup, remote, hotkeys and badge project one snapshot.
- `SCTRL-015`: MAIN cannot bypass user activation, CORS, DRM or inaccessible media.
- `SCTRL-016`: product UX exposes outcomes, not implementation modes.
- `SCTRL-017`: a page-native observation commits actual state once and never echoes a second write.
- `SCTRL-018`: top-level-only scope is explicit; passive bootstrap readback is bounded and cannot become a mutation/subscription path.
- `SCTRL-019`: one visualizer IPC owns the next schedule; a slow request cannot create an empty 15 Hz wake-up loop.
- `SCTRL-020`: Popup fields project only `ControlSnapshot`; audio session data owns lifecycle only.
- `SCTRL-021`: visualizer ownership is per subscriber, expires abnormal exits and retains a bounded generation tombstone.
- `SCTRL-022`: every hotkey has exactly one feedback owner; generic listener feedback is contract-gated.
- `SCTRL-023`: screenshot source and geometry are token-verified on both sides of browser capture.
- `SCTRL-024`: document runtime ownership counts unique consumer tokens; only the last token may dispose it.
- `SCTRL-025`: `activeMedia` and `activeVideo` are independent actual identities; every video-only surface routes to the latter.
- `SCTRL-026`: a neutral CSS value on a never-owned target is a DOM-free no-op and cannot acquire or delete owner state.
- `SCTRL-027`: a site-native ACK is one-shot and requires a bounded quiet window plus stable official getter.
- `SCTRL-028`: default pages have zero audio work; after explicit irreversible Media WebAudio binding only the minimal unity route may survive until navigation.
- `SCTRL-029`: an ACK target is projected only through its contract scope; video-only and tab/document operations cannot overwrite or clear the unrelated active identity.
- `SCTRL-030`: runtime status/read is a pure projection: it installs no listener, performs no document scan, changes no selection/correlation/owner state and emits no synthetic event; only the bounded bootstrap getter may scan before runtime acquisition.
- `SCTRL-031`: extension-UI, tab, sandbox and document-scoped operations that execute no media writer acknowledge `target:null`; they cannot borrow the currently active media identity.
- `SCTRL-032`: processor configuration exposes only `boostGain: 1–8`; page volume, media mute and a zero-gain mute substitute cannot cross the WebAudio/Capture boundary.
- `SCTRL-033`: Background control consumers invoke the serialized coordinator directly; MV3 worker self-RPC is forbidden, and remote state is cached privately before authentication then exposed only after HMAC success.
- `SCTRL-034`: the default content bootstrap uses only the minimal bootstrap contract; production extension pages may share private ESM chunks, and artifact integrity measures transitive entry/default-startup closures while rejecting unreachable or avoidably duplicated output.
- `SCTRL-035`: native event-driven writes install their bounded listener before the setter and cannot ACK until the event/quiet/stabilized getter boundary completes.
- `SCTRL-036`: strategy escalation consumes only canonical typed failure codes; activation, permission, stale identity, CORS and protected-content failures are terminal.
- `SCTRL-037`: processor actual state comes only from normalized graph/host readback (`graphSignature`, actual config, source count and context state), never from desired input echo.
- `SCTRL-038`: WebAudio/Capture transitions neutralize the old DSP, verify the candidate actual path and only then release; failure restores the previous stable route.
- `SCTRL-039`: visible Popup and authenticated remote synchronization requires independent document observation tokens; ordinary status reads acquire none.
- `SCTRL-040`: successful per-media desired replay is separate from page observation; a page event cannot become a document-global restore template.
- `SCTRL-041`: user-activation-bound APIs execute only inside a trusted page event stack or return the native activation error; no cross-process gesture emulation exists.
- `SCTRL-042`: video enhancement implementation is a lazy capability-owned module; native-only/default control does not load or instantiate it.
- `SCTRL-043`: Popup, Options and remote use a restricted protocol validator and cannot import or execute the Background request router.
- `SCTRL-044`: production property mangling stops at every external ABI. Browser/Chrome dictionaries, transport payloads, ESM exports and versioned singleton members retain their names; PeerJS is a separately isolated local vendor artifact with only private underscore members eligible for mangling.

## §21 Migration and release gate

The migration order is contracts/coordinator, runtime loaders, unique native writer, site adapters, per-field planner, safe audio graph, media/video executors, UI projection, then removal of old compatibility code. The static checker becomes mandatory before the old path is removed from the release branch.

Chrome integration must prove constructor/descriptor identity on untouched pages, side-effect-free reads, one writer per field, actual ACK ordering, page-to-Popup/remote synchronization, safe CORS decisions, source uniqueness, user-activation errors, CSS restoration, no hidden visualizer IPC and clean disposal after navigation/update.
