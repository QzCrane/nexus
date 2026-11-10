---
type: reference
status: stable
audience: developer
owner: spectra-control-architecture
last_reviewed: 2026-11-09
---

# SPECTRA control architecture

This is the sole entrypoint for SPECTRA control semantics. Normative content is split by topic in this directory; this index contains navigation and release-gated totals only.

Do not copy a topic's rules back into this file. Change the topic owner, executable contracts, tests, and static gate in one closure.

## Topic index

| # | Owner | Scope |
| --- | --- | --- |
| 01 | [01-foundations.md](01-foundations.md) | product semantics, control flow, and state ownership |
| 02 | [02-strategy-and-routes.md](02-strategy-and-routes.md) | strategy order, site routes, runtime READY, feedback, exact-element page media, PiP, fullscreen |
| 03 | [03-ui-and-boundaries.md](03-ui-and-boundaries.md) | UI, visualizer, privileged boundaries, loading topology, failure escalation |
| 04 | [04-algorithm-matrix.md](04-algorithm-matrix.md) | capability and source-algorithm matrix entrypoint |
| 05 | [05-control-state.md](05-control-state.md) | field state, echo correlation, processor handoff, volume, mute, DSP |
| 06 | [06-media-and-video.md](06-media-and-video.md) | media identity and selection, playback, video effects, screenshots |
| 07 | [07-runtime-and-performance.md](07-runtime-and-performance.md) | runtime cost, implementation ownership, migration ledger, cross-world boundary |
| 08 | [08-invariants-and-gates.md](08-invariants-and-gates.md) | SCTRL invariants and release gate |
| 09 | [09-failure-index.md](09-failure-index.md) | symptom → root cause → rule index |

## Invariant index

Index only. The normative sentence, its anchors, its executable proof (08 §20.1) and its
gate live in [08-invariants-and-gates.md](08-invariants-and-gates.md); this list exists so a
reader can find the number without opening the whole owner, and so a review can say "this
breaks `SCTRL-054`" instead of describing the bug again.

- **SCTRL-001** — untouched pages keep native constructor/descriptor identity with zero processing and zero periodic work.
- **SCTRL-002** — planning is per field; no page-wide mode owns unrelated controls.
- **SCTRL-003** — one writer per `{document, media, field}`: async primitives vs orchestration, never a second setter.
- **SCTRL-004** — no generic MAIN monkey-patching; only two allowlisted `document_start` bridges.
- **SCTRL-005** — only readback actual may be acknowledged; settings success needs physical storage confirmation.
- **SCTRL-006** — intent and ACK identity includes document, generation, revision and intent id, revalidated after every await.
- **SCTRL-007** — 100% and 1x are literal controlled values.
- **SCTRL-008** — Capture admission is typed, current-document, one-shot, and consumed before acquisition.
- **SCTRL-009** — removing extension CSS restores the site's current cascade; dim handoff keeps independent effects.
- **SCTRL-010** — transport and video state are bound to media id and source revision.
- **SCTRL-011** — at most one acknowledged processor owns DSP output; handoff never double-applies and a failed candidate keeps the acknowledged one.
- **SCTRL-012** — status and observation reads never write settings, badge, or processing.
- **SCTRL-013** — neutral DSP and unsubscribed analysis create no optional nodes; no hidden visualizer chunk, observer or timer.
- **SCTRL-014** — every surface projects one snapshot; the badge has one writer, paints no placeholder, and the newest decision wins.
- **SCTRL-015** — MAIN cannot bypass activation, CORS, DRM or inaccessible media.
- **SCTRL-016** — UX exposes outcomes, not implementation modes; exact 28-field / 23-operation inventory.
- **SCTRL-017** — a page observation is admitted by the pure value owner, commits actual once, never echoes a second write.
- **SCTRL-018** — control scope is top-level only; inventory projects through the shared membership policy; expiry hides without deleting.
- **SCTRL-019** — one visualizer IPC owns the next schedule.
- **SCTRL-020** — Popup fields project only `ControlSnapshot`; audio session data owns lifecycle only.
- **SCTRL-021** — visualizer ownership is per subscriber and exact document, with a bounded tombstone and compensated ambiguous ACKs.
- **SCTRL-022** — each hotkey has one feedback owner on a fullscreen-safe top layer; Chrome chords never become site bindings.
- **SCTRL-023** — screenshot source and geometry are token-verified on both sides of browser capture.
- **SCTRL-024** — document runtime ownership counts consumer tokens; only the last disposes.
- **SCTRL-025** — `activeMedia` and `activeVideo` are independent; a different document is accepted only at a higher tab generation.
- **SCTRL-026** — a neutral CSS value on a never-owned target is a DOM-free no-op.
- **SCTRL-027** — native candidate admission and ACK are one-shot; a rejected maturation restores baseline and prior DOM state.
- **SCTRL-028** — default pages do zero audio work; 0 and 100 remain current demands until an explicit release ACK.
- **SCTRL-029** — ACK target is projected only through contract scope; non-media operations write `null`.
- **SCTRL-030** — runtime status and reads are a pure projection, with no document scan or synthetic event.
- **SCTRL-031** — an operation that executes no media writer acknowledges a null target.
- **SCTRL-032** — native audio keeps page volume/mute; Capture output uses `outputLevel` 0–8 with `boostGain` 1.
- **SCTRL-033** — background consumers call the serialized coordinator directly, never through SW self-RPC.
- **SCTRL-034** — minimal content bootstrap, self-contained SW ESM, and extracted capabilities that are owners rather than aliases.
- **SCTRL-035** — event-driven writes install the bounded listener before the setter and ACK after the quiet getter boundary.
- **SCTRL-036** — escalation consumes canonical failure codes; security and activation failures are terminal.
- **SCTRL-037** — processor actual comes only from normalized graph and host readback.
- **SCTRL-038** — Capture replacement gates at zero gain, verifies the running graph, switches once, retires the old owner after success.
- **SCTRL-039** — visible Popup and authenticated remote sync each need their own document observation token.
- **SCTRL-040** — durable projection wins, then site preset, then global preset.
- **SCTRL-041** — a new Capture requires volatile background admission.
- **SCTRL-042** — video enhancement is lazy; default control does not load it.
- **SCTRL-043** — restricted protocol validators only; UI event routing is never a second settings or control owner.
- **SCTRL-044** — one esbuild optimization pass; only the PeerJS vendor enters Terser.
- **SCTRL-045** — physical write and stabilization proof are separate facts; only eligible optimistic volume/mute answer `written` early.
- **SCTRL-046** — a newer write cancels the proof it supersedes; a proven drift republishes the true value and demotes the origin.
- **SCTRL-047** — one writing module per projection element, and projection surfaces never import another surface.
- **SCTRL-048** — the presented number is always the live optimistic value; a route transaction holds tone and mute only.
- **SCTRL-049** — slider and badge share one tone predicate; a threshold never implies Capture.
- **SCTRL-050** — Popup first frame contains every announced slot; structure decides size; frame-height owns live geometry.
- **SCTRL-051** — a site policy attribute that gates a native session is held for the session and restored only when it ends.
- **SCTRL-052** — the badge is a projection, never a second owner, and it synchronizes while Popup is closed.
- **SCTRL-053** — the MAIN bridge resolves bounded exact-element capabilities only; it never intercepts audio or drives site sliders.
- **SCTRL-054** — a live stream is read from the element: unbounded duration refuses `speed` before the write and publishes `live`.
- **SCTRL-055** — a page-set mute is a fact, not a preference; it may be recorded but never replayed into a later document.
- **SCTRL-056** — automatic admission ranks playing, then visible confirmed live, then area.
- **SCTRL-057** — Popup, OSD and badge share one tone predicate; a gesture uses the current target's prospective route.
- **SCTRL-058** — every `effective-volume` gesture reads the current target's volume/mute pair before planning.
- **SCTRL-059** — retirement is decided when the queued removal settles; a still-connected node keeps its identity.
- **SCTRL-060** — detached, source-change and replaced-element are three different events and never substitute for each other.
- **SCTRL-061** — a media id names one element instance for life; it is never recycled onto a replacement.
- **SCTRL-062** — retiring a source clears its pending, observed, replay and maturation state.
- **SCTRL-063** — site-route selection sorts by user over automatic, then hostname specificity, then path length.
- **SCTRL-064** — a path prefix matches on a segment boundary only; query and hash never decide a route.
- **SCTRL-065** — a user `direct` route forbids the Capture fallback; a `capture` preference still needs its admission.
- **SCTRL-066** — observation identity is a four-tuple: epoch for owners, selection then revision within one owner.
- **SCTRL-067** — an automatic restore replays only when scene, visit and desired revision all match.
- **SCTRL-068** — the media-intent state is three-valued lifecycle evidence, never a second desired store.
- **SCTRL-069** — a gesture forecast changes the tone only and never writes actual, usage or settings.
- **SCTRL-070** — silence outranks route: muted or zero is grey even under an acknowledged Capture.
- **SCTRL-071** — a lit badge is a durable fact; after worker collection it falls back to the usage record.
- **SCTRL-072** — the continuous port merges within 50 ms and needs a ready acknowledgement within 5 s.
- **SCTRL-073** — the per-document audio session merges writes at 250 ms with bounded retries.
- **SCTRL-074** — adapter discovery defaults to 12 ancestors and 96 properties, and never raises its own ceiling.
- **SCTRL-075** — every `none | lean | full` transition is one ordered five-step transaction.
- **SCTRL-076** — lean and full never both own the keyboard in one realm, enforced by a revision-2 marker.
- **SCTRL-077** — worker-restart recovery rebuilds three owner classes before releasing its temporary lease.
- **SCTRL-078** — the first control of a cold document injects immediately instead of waiting for idle.
- **SCTRL-079** — an optional-permission request is the first asynchronous Chrome call in the gesture handler.
- **SCTRL-080** — runtime consumers read permission state and never request it.
- **SCTRL-081** — a v2 listener owns an exact request-type set; the retired action envelope never ships.
- **SCTRL-082** — screenshot geometry is token-verified on both sides of the browser capture.
- **SCTRL-083** — a frame step is always acknowledged as approximate.

## Release-gated totals

- **51 contract capabilities**: 15 native-only + 8 hybrid extension/native + 26 augmentation-only + 2 observation-only
- **28 persistent snapshot fields + 23 momentary operations**
- **50 audited source algorithms**: `ALG-001..ALG-050`
- **Invariants**: `SCTRL-001..SCTRL-083`, numbered contiguously in [08](08-invariants-and-gates.md).

These totals mirror executable contracts and gates. A count changes only with contract rows, source catalog, tests, owner documentation, and verifier updates.

The invariant count is not maintained by hand here. `check-spectra-control.ts` parses the
`SCTRL-*` entries out of 08, asserts the numbering runs `001..N` without gaps, asserts
every documented ID is in its mandatory-anchor inventory or its explicit no-anchor list,
and asserts that the range printed in this file equals what it parsed. Any drift fails the
gate instead of leaving a stale number in a page nobody re-reads.

## Diagram and business-flow index

图随业务 owner 维护；本表只导航，不复制状态定义。合同、实现和测试是可执行
约束，图中的在途操作不额外创造快照 phase。

| 图 / 规则 | 唯一位置 |
| --- | --- |
| 卡片 queued/hydrating/bound/unavailable、原节点重绑与退休 | [Runtime first frame](../architecture/runtime.md#action-popup-first-frame) |
| 从意图到实际快照的总控制流 | [01 §2](01-foundations.md#2-control-flow-and-state-ownership) |
| 字段事务状态机 | [05 Field transaction state](05-control-state.md#field-transaction-state) |
| 浏览器可运行性、document 与媒体场景独立状态轴 | [Runtime lifecycle axes](../architecture/runtime.md#browser-document-and-media-lifecycle-axes) |
| 自然登记、动态成员、最近暂停与到期隐藏决策图 | [06 Document-level inventory](06-media-and-video.md#131-document-level-inventory) |
| Popup 全部 slot 首帧、原节点绑定与实际值时序 | [Runtime presentation and actual confirmation](../architecture/runtime.md#presentation-and-actual-confirmation) |
| 物理采样与长 speed writer 的双 lane、字段顺序保护 | [05 Ordered physical observations](05-control-state.md#ordered-physical-observations) |
| written / confirmed / drifted / unconfirmed 证明状态机 | [05 Native write proof state](05-control-state.md#native-write-proof-state) |
| SPA route / document / media source 生命线及 source 状态机 | [06 SPA identity and source lifecycle](06-media-and-video.md#133-spa-identity-and-source-lifecycle) |
| 关闭直播、隐藏、移除、无目标、Popup 关闭与恢复决策表 | [06 Closing live players and speed inheritance](06-media-and-video.md#134-closing-live-players-and-speed-inheritance) |
| document 恢复意图三态、场景 2/1.5 往返与 stale restore 取消 | [06 Document replay intent lifetime](06-media-and-video.md#135-document-replay-intent-lifetime) |
| 首次 Popup 播放状态、切换 baseline、缓冲播放与有界 ACK | [06 Playback button and buffered play](06-media-and-video.md#141-playback-button-and-buffered-play) |
| 自由倍速准入、page/DOM writer、失败与补偿决策图 | [06 Speed decision and failure](06-media-and-video.md#143-speed-decision-and-failure) |
| 直播传输不能调速的边界 | [06 Live transport limits](06-media-and-video.md#144-live-transport-limits) |
| 倍速写入、actual 标签、ACK 和 Popup 时序图 | [06 Speed intent and projection sequence](06-media-and-video.md#146-speed-intent-and-projection-sequence) |
| 每条媒体业务规则对应的回归规格 | [06 Regression coverage map](06-media-and-video.md#147-regression-coverage-map) |
| 跨上下文运行时图、导航 fencing 时序 | [Runtime ownership / Audio lifecycle](../architecture/runtime.md#runtime-ownership) |
| 策略阶梯、Capture 准入状态机、三级路由裁决、三 owner 音频选路 | [02 §3–§4.1](02-strategy-and-routes.md) |
| 表面投影所有权、加载拓扑、失败升级两条分支 | [03 §7–§7.3](03-ui-and-boundaries.md) |
| 字段作用域分层（谁描述谁，不是优先级） | [04a §8](04a-algorithm-matrix.md) |
| 算法审核的四个必答问题 | [04b §9](04b-source-algorithms.md) |
| 音量色调判决（灰/蓝/紫与手势前瞻） | [05 §11.2](05-control-state.md#112-tone-ownership) |
| 四层身份与三种身份事件 | [06 §13.3](06-media-and-video.md#133-spa-identity-and-source-lifecycle) |
| Runtime lease 生命周期、观察交接、跨世界边界 | [07 §16–§18](07-runtime-and-performance.md) |
| 不变量四件套、五项门禁流水线、closure 顺序 | [08 §20–§21.2](08-invariants-and-gates.md) |
| 症状分流决策图 | [09 §22.2](09-failure-index.md) |
| 音频 owner 选路、Capture 准入序列 | [Source admission](../architecture/media-source-admission.md) |
| 远程信任边界、challenge/HMAC 认证序列 | [Remote security](../security/remote-control.md) |
| 控制事务序列、观察排序判定、lean/full 过渡、worker 重启七步 | [Protocols](../reference/protocols.md) |

## Neighbor owners

- [Runtime topology](../architecture/runtime.md)
- [Cross-context protocols](../reference/protocols.md)
- [Remote security](../security/remote-control.md)
- [Capture source admission](../architecture/media-source-admission.md)
- [Roadmap](../roadmap.md)
- [SPECTRA documentation map](../README.md)
- [Repository documentation map](../../../../docs/README.md)

## Core entry points

Six files answer most "where is this?" questions. The complete map, including the
responsibilities that span files, is
[07 §17](07-runtime-and-performance.md#17-implementation-ownership-and-migration-map).

- contracts: `packages/contracts/src/control.contracts.ts`
- control authority: `src/background/control-coordinator.ts`
- pure control values: `src/background/control-coordinator-values.ts`
- physical native async writer/readback: `src/content/logic/native-media-async.ts`
- native target/ownership/rollback orchestration: `src/content/logic/native-media-executor.ts`
- static verification: `scripts/verify/check-spectra-control.ts`

## Task to file (reverse index)

The forward index says what each file owns. This one answers the question people
actually have: "I want to change X — which files and which rules are in the way?"

| I need to change | Read first | Then touch | Governing rule |
| --- | --- | --- | --- |
| A reported symptom, before anything else | [09-failure-index.md](09-failure-index.md) | — | — |
| One control field end to end | `packages/contracts/src/control.contracts.ts` | executor field branch → coordinator commit → Popup projection | `SCTRL-003`, `SCTRL-006` |
| Volume or mute policy | [05 §11](05-control-state.md#11-volume-and-mute) | `control-coordinator-values.ts` → `native-media-executor.ts` → `native-write-policy.ts` | `SCTRL-045`, `SCTRL-055`, `SCTRL-058` |
| Speed, including live refusal | [06 §14.3](06-media-and-video.md#143-speed-decision-and-failure) + [§14.10](06-media-and-video.md#1410-live-streams-withhold-the-field-publish-the-fact) | speed branch of `native-media-executor.ts` → `page-media-bridge.ts` | `SCTRL-054` |
| Which element the controls belong to | [06 §13](06-media-and-video.md#13-active-media) | `media-registry.ts` | `SCTRL-056`, `SCTRL-025` |
| Site-native volume UI sync | [06 §14.10](06-media-and-video.md#1410-live-streams-withhold-the-field-publish-the-fact) | `capabilityFor` in `page-media-bridge.ts` → `site-adapter-registry.ts` | `SCTRL-053` |
| Action badge behaviour | [05 §11.3](05-control-state.md#113-badge-projection-route) | `background/handlers/badge.ts` → `projectBadgeFromSnapshot` | `SCTRL-052`, `SCTRL-014` |
| Popup first frame or height | [runtime §Action Popup first frame](../architecture/runtime.md#action-popup-first-frame) | `popup-first-paint.ts` → `popup/frame-height.ts` | `SCTRL-050` |
| Video effects or screenshot | [06 §15](06-media-and-video.md#15-video-effects-and-screenshot) | `video-effects-controller.ts` → `background/handlers/screenshot.ts` | `SCTRL-042`, `SCTRL-023` |
| A protocol message | [protocols](../reference/protocols.md) | contracts wire owner, never a new route | `SCTRL-006`, `SCTRL-034` |
| A new invariant | [08](08-invariants-and-gates.md) | add the ID, its anchors, its test, and the verifier entry | `SCTRL-016` |

## Historical evidence

Dated development, regression, and optimization reports live under [`../_archive/2026-Q3/`](../_archive/2026-Q3/README.md). They preserve the state of their named commit and are not current behavior owners.
