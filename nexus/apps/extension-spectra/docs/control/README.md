---
type: reference
status: stable
audience: developer
owner: spectra-control-architecture
last_reviewed: 2026-11-02
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

## Release-gated totals

- **51 contract capabilities**: 17 native-only + 6 hybrid extension/native + 26 augmentation-only + 2 observation-only
- **28 persistent snapshot fields + 23 momentary operations**
- **50 audited source algorithms**: `ALG-001..ALG-050`
- **50 static invariants**: `SCTRL-001..SCTRL-050`

These totals mirror executable contracts and gates. A count changes only with contract rows, source catalog, tests, owner documentation, and verifier updates.

## Diagram and business-flow index

图随业务 owner 维护；本表只导航，不复制状态定义。合同、实现和测试是可执行
约束，图中的在途操作不额外创造快照 phase。

| 图 / 规则 | 唯一位置 |
| --- | --- |
| 从意图到实际快照的总控制流 | [01 §2](01-foundations.md#2-control-flow-and-state-ownership) |
| 字段事务状态机 | [05 Field transaction state](05-control-state.md#field-transaction-state) |
| Popup 首帧结构、身份绑定与实际值确认状态机 | [Runtime presentation and actual confirmation](../architecture/runtime.md#presentation-and-actual-confirmation) |
| written / confirmed / drifted / unconfirmed 证明状态机 | [05 Native write proof state](05-control-state.md#native-write-proof-state) |
| SPA route / document / media source 生命线及 source 状态机 | [06 SPA identity and source lifecycle](06-media-and-video.md#spa-identity-and-source-lifecycle) |
| 关闭直播、隐藏、移除、无目标、Popup 关闭与恢复决策表 | [06 Closing live players and speed inheritance](06-media-and-video.md#closing-live-players-and-speed-inheritance) |
| document 恢复意图三态、选择访问、运行时租约与后台重启 | [06 Document replay intent lifetime](06-media-and-video.md#document-replay-intent-lifetime) |
| 首次 Popup 播放状态、切换 baseline、缓冲播放与有界 ACK | [06 Playback button and buffered play](06-media-and-video.md#playback-button-and-buffered-play) |
| 自由倍速准入、page/DOM writer、失败与补偿决策图 | [06 Speed decision and failure](06-media-and-video.md#speed-decision-and-failure) |
| 直播传输不能调速的边界 | [06 Live transport limits](06-media-and-video.md#live-transport-limits) |
| 倍速写入、actual 标签、ACK 和 Popup 时序图 | [06 Speed intent and projection sequence](06-media-and-video.md#speed-intent-and-projection-sequence) |
| 每条媒体业务规则对应的回归规格 | [06 Executable coverage and limits](06-media-and-video.md#executable-coverage-and-limits) |
| 跨上下文运行时图、导航 fencing 时序 | [Runtime ownership / Audio lifecycle](../architecture/runtime.md#runtime-ownership) |

## Neighbor owners

- [Runtime topology](../architecture/runtime.md)
- [Cross-context protocols](../reference/protocols.md)
- [Remote security](../security/remote-control.md)
- [Capture source admission](../architecture/media-source-admission.md)
- [Roadmap](../roadmap.md)
- [SPECTRA documentation map](../README.md)
- [Repository documentation map](../../../../docs/README.md)

## Implementation and verification

- contracts: `packages/contracts/src/control.contracts.ts`
- control authority: `src/background/control-coordinator.ts`
- pure control values: `src/background/control-coordinator-values.ts`
- physical native async writer/readback: `src/content/logic/native-media-async.ts`
- native target/ownership/rollback orchestration: `src/content/logic/native-media-executor.ts`
- static verification: `scripts/verify/check-spectra-control.ts`

## Historical evidence

Dated development, regression, and optimization reports live under [`../_archive/2026-Q3/`](../_archive/2026-Q3/README.md). They preserve the state of their named commit and are not current behavior owners.
