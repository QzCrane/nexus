---
type: reference
status: stable
audience: developer
last_reviewed: 2026-07-30
---

# 08. Invariants & Gates (SCTRL-001..044 and migration gate)

> 主题 owner 段: §20 Static invariants · §21 Migration and release gate
> 完整目录: [README.md](README.md)

## §20 Static invariants

- `SCTRL-001`: untouched pages preserve native audio/media constructor and descriptor identity outside the allowlisted fullscreen method wrapper, with zero processing/periodic work.
- `SCTRL-002`: planning is per field; no page-wide mode owns unrelated controls.
- `SCTRL-003`: one writer exists for each `{document, media, field}`.
- `SCTRL-004`: generic MAIN monkey-patching is forbidden; fullscreen V1 (`content-fullscreen-bridge.js`) and page-media V2 (`content-page-media-bridge.js`) are the only allowlisted manifest entries at `document_start`.
- `SCTRL-005`: only readback actual state may be acknowledged; settings/session success require physical storage confirmation.
- `SCTRL-006`: intent and ACK identity includes document, generation, revision and intent ID.
- `SCTRL-007`: 100% and 1x are literal controlled values.
- `SCTRL-008`: MediaElementSource eligibility is proven before irreversible binding.
- `SCTRL-009`: extension CSS removal restores the site's current cascade; dim-target handoff preserves independent video effects.
- `SCTRL-010`: transport/video state is bound to media ID and source revision.
- `SCTRL-011`: Capture is last-resort; processor handoff never double-applies DSP and restores stable configuration on failure.
- `SCTRL-012`: status and observation reads do not write settings, badge, or activate processing.
- `SCTRL-013`: neutral DSP and unsubscribed analysis create no nodes; Media WebAudio post-binding lifetime must be explicit and bounded (`page-lifetime-after-media-binding`), retaining `the smallest source -> gain -> destination route until navigation`; visualizer IPC must not leave a timer wake-up loop while a batch is pending.
- `SCTRL-014`: page, Popup, remote, hotkeys and badge project one snapshot; Badge renders no placeholder before complete ACK exists.
- `SCTRL-015`: MAIN cannot bypass user activation, CORS, DRM or inaccessible media.
- `SCTRL-016`: product UX exposes outcomes, not implementation modes; records exact 28 persistent snapshot fields plus 23 momentary operations inventory.
- `SCTRL-017`: a page-native observation commits actual state once and never echoes a second write.
- `SCTRL-018`: top-level-only scope is explicit; bootstrap observation order is bounded and yields to heavy runtime.
- `SCTRL-019`: one visualizer IPC owns the next schedule.
- `SCTRL-020`: Popup fields project only `ControlSnapshot`; audio session data owns lifecycle only.
- `SCTRL-021`: visualizer ownership is per subscriber, expires abnormal exits and retains a bounded generation tombstone.
- `SCTRL-022`: every hotkey has exactly one feedback owner on a fullscreen-safe browser top-layer surface.
- `SCTRL-023`: screenshot source and geometry are token-verified on both sides of browser capture.
- `SCTRL-024`: document runtime ownership counts unique consumer tokens; only the last token disposes it.
- `SCTRL-025`: `activeMedia` and `activeVideo` are independent actual identities; video-only surfaces route to `activeVideo`.
- `SCTRL-026`: a neutral CSS value on a never-owned target is a DOM-free no-op.
- `SCTRL-027`: native candidate admission and ACK are one-shot; rejected maturation restores page baseline & prior DOM state.
- `SCTRL-028`: default pages have zero audio work; WebAudio binding retains only minimal unity route until navigation.
- `SCTRL-029`: ACK target is projected only through contract scope; non-media operations write `target: null`.
- `SCTRL-030`: runtime status/read is a pure projection with no document scan or synthetic event.
- `SCTRL-031`: operations executing no media writer acknowledge `target: null`.
- `SCTRL-032`: processor configuration exposes only `boostGain: 1–8`; page volume/mute cannot cross WebAudio/Capture boundary.
- `SCTRL-033`: Background control consumers invoke serialized coordinator directly without SW self-RPC.
- `SCTRL-034`: default content bootstrap uses minimal contract; MV3 SW is self-contained ESM; build has zero redundancy.
- `SCTRL-035`: native event-driven writes install bounded listener before setter and ACK after quiet getter boundary.
- `SCTRL-036`: strategy escalation consumes canonical failure codes; security/activation failures are terminal.
- `SCTRL-037`: processor actual state comes only from normalized graph/host readback (`graphSignature`).
- `SCTRL-038`: WebAudio/Capture transitions neutralize old DSP, verify candidate path, and release on success.
- `SCTRL-039`: visible Popup and authenticated remote synchronization require independent document observation tokens.
- `SCTRL-040`: `CONTROL_SESSION_FIELDS` durable projection wins first, then site preset, then global preset.
- `SCTRL-041`: new Capture requires volatile Background admission (`captureAdmission: 'extension-invocation'`).
- `SCTRL-042`: video enhancement is a lazy capability-owned module; default control does not load it.
- `SCTRL-043`: Popup, Options and remote use restricted protocol validators and cannot load Background request router.
- `SCTRL-044`: production application bundles have one esbuild optimization pass; only PeerJS vendor enters Terser.

## §21 Migration and release gate

Migration order: `Contracts/Coordinator -> Runtime Loaders -> Native Writer -> Page Bridge -> Capability Planner -> Safe Audio Graph -> Executors -> UI -> Legacy Removal`. Enforced by `scripts/verify/check-spectra-control.ts`.
