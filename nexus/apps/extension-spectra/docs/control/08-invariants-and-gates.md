---
type: reference
status: stable
audience: developer
last_reviewed: 2026-08-28
---

# 08. Invariants & Gates (SCTRL-001..044 and migration gate)

> 主题 owner 段: §20 Static invariants · §21 Migration and release gate
> 完整目录: [README.md](README.md)

## §20 Static invariants

- `SCTRL-001`: untouched pages preserve native audio/media constructor and descriptor identity outside the allowlisted fullscreen method wrapper, with zero processing/periodic work.
- `SCTRL-002`: planning is per field; no page-wide mode owns unrelated controls.
- `SCTRL-003`: one writer exists for each `{document, media, field}`; `native-media-async.ts` owns physical async setters/readback while `native-media-executor.ts` owns target and rollback orchestration, never a second setter.
- `SCTRL-004`: generic MAIN monkey-patching is forbidden; fullscreen V1 (`content-fullscreen-bridge.js`) and page-media V2 (`content-page-media-bridge.js`) are the only allowlisted manifest entries at `document_start`.
- `SCTRL-005`: only readback actual state may be acknowledged; settings/session success require physical storage confirmation.
- `SCTRL-006`: intent and ACK identity includes document, generation, revision and intent ID; Remote additionally requires `sessionEpoch + commandId`, and every post-await continuation revalidates its full ticket.
- `SCTRL-007`: 100% and 1x are literal controlled values.
- `SCTRL-008`: a typed, current-document, one-shot Capture admission is consumed before tab-stream acquisition; MediaElement WebAudio binds page sources only after complete exact source-safety evidence, while Capture never binds page media sources.
- `SCTRL-009`: extension CSS removal restores the site's current cascade; dim-target handoff preserves independent video effects.
- `SCTRL-010`: transport/video state is bound to media ID and source revision.
- `SCTRL-011`: at most one acknowledged MediaElement WebAudio or Capture processor owns DSP output; replacement handoff never double-applies DSP and preserves the acknowledged processor on candidate failure.
- `SCTRL-012`: status and observation reads do not write settings, badge, or activate processing.
- `SCTRL-013`: neutral DSP and unsubscribed analysis create no optional nodes; only an acknowledged active MediaElement WebAudio or admitted Capture owner may retain its `AudioContext`, sources and sparse graph, all of which are disposed on final release; disabled Popup Visualizer imports no visualizer chunk and owns no metrics observer/draw loop; only the visible foreground subscriber may request transient processor observation, background cards remain passive, and visualizer IPC leaves no timer wake-up loop while a batch is pending.
- `SCTRL-014`: page, Popup, remote, hotkeys and badge project one snapshot; Popup owns one tab-routed runtime event hub and one card audio/config projection; Badge renders no placeholder before complete ACK exists.
- `SCTRL-015`: MAIN cannot bypass user activation, CORS, DRM or inaccessible media.
- `SCTRL-016`: product UX exposes outcomes, not implementation modes; records exact 28 persistent snapshot fields plus 23 momentary operations inventory.
- `SCTRL-017`: a page-native observation is admitted by the pure coordinator-value owner, commits actual state once, and never echoes a second write.
- `SCTRL-018`: control target scope is top-level-only; passive inventory separately performs a bounded document-fenced frame census, preserves unknown coverage, never loads the heavy runtime, and maps legacy v2 responses without coverage to unknown rather than complete.
- `SCTRL-019`: one visualizer IPC owns the next schedule.
- `SCTRL-020`: Popup fields project only `ControlSnapshot`; audio session data owns lifecycle only.
- `SCTRL-021`: visualizer ownership is per subscriber and exact document; it expires abnormal exits, retains a bounded generation tombstone, compensates ambiguous enable/release ACKs, and cannot persist transient Capture demand across worker/session restoration.
- `SCTRL-022`: every hotkey has exactly one feedback owner on a fullscreen-safe browser top-layer surface; built-in Chrome chords cannot become site bindings, and legacy collisions are durably disabled through the canonical normalization owner.
- `SCTRL-023`: screenshot source and geometry are token-verified on both sides of browser capture.
- `SCTRL-024`: document runtime ownership counts unique consumer tokens; only the last token disposes it.
- `SCTRL-025`: `activeMedia` and `activeVideo` are independent actual identities; video-only surfaces route to `activeVideo`; UI accepts a different document only at a higher tab generation and rejects delayed old-document projections.
- `SCTRL-026`: a neutral CSS value on a never-owned target is a DOM-free no-op.
- `SCTRL-027`: native candidate admission and ACK are one-shot; rejected maturation restores page baseline & prior DOM state.
- `SCTRL-028`: default pages have zero audio work; no Capture processor, offscreen audio lease or audio context survives a neutral release.
- `SCTRL-029`: ACK target is projected only through contract scope; non-media operations write `target: null`.
- `SCTRL-030`: runtime status/read is a pure projection with no document scan or synthetic event.
- `SCTRL-031`: operations executing no media writer acknowledge `target: null`.
- `SCTRL-032`: processor configuration exposes only `boostGain: 1–8`; page volume/mute cannot cross either processor boundary.
- `SCTRL-033`: Background control consumers invoke serialized coordinator directly without SW self-RPC.
- `SCTRL-034`: default content bootstrap uses minimal contract; MV3 SW is self-contained ESM; build has zero redundancy; extracted pure value/ACK/queue/async capabilities are direct owners rather than aliases or re-export shims, while coordinator commit/persist/publish remains the sole effect writer.
- `SCTRL-035`: native event-driven writes install bounded listener before setter and ACK after quiet getter boundary.
- `SCTRL-036`: strategy escalation consumes canonical failure codes; security/activation failures are terminal.
- `SCTRL-037`: processor actual state comes only from normalized graph/host readback (`graphSignature`).
- `SCTRL-038`: Capture generation replacement gates the candidate at zero gain, verifies running graph readback, switches once, and retires the old processor only after success.
- `SCTRL-039`: visible Popup and authenticated remote synchronization require independent document observation tokens.
- `SCTRL-040`: `CONTROL_SESSION_FIELDS` durable projection wins first, then site preset, then global preset.
- `SCTRL-041`: new Capture requires volatile Background admission (`captureAdmission: 'extension-invocation'`).
- `SCTRL-042`: video enhancement is a lazy capability-owned module; default control does not load it.
- `SCTRL-043`: Popup, Options and remote use restricted protocol validators and cannot load Background request router; UI event routing cannot become a second settings/control protocol owner.
- `SCTRL-044`: production application bundles have one esbuild optimization pass; only PeerJS vendor enters Terser.

## §21 Migration and release gate

Closure order: `Contracts/Coordinator -> Runtime Loaders -> Native Writer -> Page Bridge -> Capture Host -> Executors -> UI -> Retired-owner deletion`. Enforced by `scripts/verify/check-spectra-control.ts`.
