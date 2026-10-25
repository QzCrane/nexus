---
type: reference
status: stable
audience: developer
last_reviewed: 2026-08-28
---

# 07. Runtime & Performance (Loading, ownership map, cross-world bridges)

> 主题 owner 段: §16 Runtime loading and performance · §17 Implementation ownership and migration map · §18 Cross-world bridges
> 完整目录: [README.md](README.md)

## §16 Runtime loading and performance

Manifest 仅包含轻量 ISOLATED bootstrap 与两个闭合版本化 MAIN bridge（Fullscreen V1 与 Page-Media V2）。
- 空闲时仅安装 HELLO/消息边界与 `volumechange`/`ratechange` 事件监听；不读取设置、不扫描媒体、不创建 MutationObserver 或 DOM 标记。
- 重级 Runtime Lease 仅限定于显式控制、恢复非默认设置、观察订阅、已认证远程或配置站点快捷键。`runtime-loader.ts` 以 `Set<reason:capability>` 管理引用计数。

```text
默认静态不变式 (无显式全输出 Capture 申请时):
0 extension AudioContext
0 offscreen lease
0 generic MAIN runtime or recurring MAIN work
0 media MutationObserver
0 recurring timer/rAF/IPC
```

## §17 Implementation ownership and migration map

| Location | Target responsibility |
| --- | --- |
| `packages/contracts/src/control.contracts.ts` | 完整字段/操作、策略类别、意图/快照/ACK guards 统一词汇表 |
| `packages/contracts/src/spectra.bootstrap.ts` | 最小常驻协议常量、极简读回与 5 组默认快捷键映射 |
| `packages/features/audio-engine/src/audio-graph-router.ts` | Offscreen Capture 使用的稀疏图、参数 ACK 与订阅式分析器 |
| `src/background/control-coordinator.ts` | 生命周期/意图串行、代际 Revision、持久化、发布、补偿与 Capture 准入门禁 |
| `src/background/control-coordinator-values.ts` | 无 Chrome/storage 副作用的 target scope、mutation、ACK、reset 与 session projection 纯值能力 |
| `src/background/control-coordinator-ack.ts` | 无副作用的完整 intent/operation ACK 身份准入；不能提交、持久化或发布 |
| `src/background/extension-invocation.ts` | 扩展调用来源身份、前景/目标文档绑定与陈旧文档拒绝 |
| `src/background/popup-visualizer-source.ts` | Popup 观察订阅的文档级租约；借用 coordinator 的串行队列与 snapshot，不持有 revision 写入权，不授予 Capture 准入 |
| `src/background/settings-value-normalization.ts` | Global/Hotkey/Site/Preset/Audio 的纯 canonical value 与旧数据修复 |
| `src/background/settings-repository.ts` | revision/CAS、容量、迁移元数据与 durable storage 事务 |
| `src/background/runtime-loader.ts` | 文档级重级 Runtime Lease 与 READY 握手 |
| `src/background/media-tab-discovery.ts` | 文档代际化、有界且公平轮转的媒体发现与被动 coverage 诊断 |
| `src/background/main-runtime-manager.ts` | 幂等注入 Fullscreen V1 与 Page-Media V2 bridges |
| `src/content/core/media-registry.ts` | `mediaId`、`sourceRevision`、缓存可见性与 Sticky Active Target 追踪 |
| `src/content/logic/native-media-async.ts` | 唯一物理 DOM 标准媒体异步写/事件+getter ACK、source cancellation 与 frame cadence cache |
| `src/content/logic/native-media-executor.ts` | Registry/target/native ownership/page fallback/rollback 编排，不复制 async writer |
| `src/content/video/video-effects-controller.ts` | 媒体 Keyed CSS / Overlay 归属与属性恢复 |
| `src/content/video/ab-loop.ts`, `time-marker.ts` | 媒体 Keyed A/B 循环与 Marker 算法及 disposer |
| `src/background/handlers/screenshot.ts` | 令牌校验、可见标签页截屏、裁剪与下载确认编排 |
| `src/popup/ui-event-hub.ts` | Popup 唯一 Chrome runtime listener、按 tab fan-out 与 subscriber failure isolation |
| `src/popup/control-snapshot-order.ts` | generation-first identity admission 与 same-generation revision 单调性 |
| `src/popup/bounded-card-bootstrap.ts` | cap-4 all-settled card worker；失败隔离后统一 badge/empty reconciliation |
| `src/remote/operation-queue.ts` | Remote 每 key 有界串行队列；不拥有 session/auth/protocol 状态 |

结构拆分不得制造第二个 effect owner。协调者仍是 commit/persist/publish 唯一入口；
ACK 模块只做值验证。原生字段的相等判定由 `native-media-async.ts` 统一提供，
Executor 不再维护第二份数值/结构比较实现。产物调整必须在同一功能和探测负载下
比较真实 metafile closure；现有硬预算不可上调，零字节或把内容移到另一统计桶不算优化。

## §18 Cross-world bridges

两个 Bridge 均为 manifest `document_start` 注册，由 `main-runtime-manager.ts` 幂等重注入:
- `__SPECTRA_FULLSCREEN_BRIDGE_V1__`: 仅包装原生 `requestFullscreen()` 入口以在 1.2s 内协调增强音频交接。
- `__SPECTRA_PAGE_MEDIA_BRIDGE_V2__`: 仅对 `volumeBase`、`mediaMuted` 与 `speed` 发起同步 DOM 事件并在请求元素上读回，不维持轮询与全局拦截。
