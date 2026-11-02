---
type: reference
status: stable
audience: developer
last_reviewed: 2026-11-02
---

# 07. Runtime & Performance (Loading, ownership map, cross-world bridges)

> 主题 owner 段: §16 Runtime loading and performance · §17 Implementation ownership and migration map · §18 Cross-world bridges
> 完整目录: [README.md](README.md)

## §16 Runtime loading and performance

Manifest 仅包含轻量 ISOLATED bootstrap 与两个闭合版本化 MAIN bridge（Fullscreen V1 与 Page-Media V2）。
- 轻量 bootstrap 使用 HELLO/消息边界、原生媒体事件和有界初次读取自然登记媒体；不为 Popup 枚举注入或唤醒标签页。声明站点的实际倍速标签仅在已由媒体信号发现的精确播放器根内安装 label-specific MutationObserver；不安装 document-wide 媒体拓扑观察器或通用轮询。
- 重级 Runtime Lease 仅限定于显式控制、恢复非默认设置、观察订阅、已认证远程或配置站点快捷键。`runtime-loader.ts` 以 `Set<reason:capability>` 管理引用计数。

```text
默认静态不变式 (无显式全输出 Capture 申请时):
0 extension AudioContext
0 offscreen lease
0 generic MAIN runtime or recurring MAIN work
0 generic media-topology MutationObserver
0 recurring timer/rAF/IPC
```

Action Popup 首帧不等待新媒体检测或实际值 RPC：Background 公告一张主卡和动态数量后台成员、语言与 visualizer 形状；head script 提交主题/surface，独立 prepaint entry 使用唯一模板和 Popup catalog 同时绘制全部已公告可见 slot，结构本身决定固有窗口尺寸。观察并发上限不限制卡片名额，也不延后后台 DOM 挂载；不按历史 count 高度保留窗口。设置水合与媒体实际值在同一节点对账，不允许英文首帧后纠正。所有九种 Popup catalog 属于关键脚本闭包，必须连同 `popup-first-paint.js` 计入 Popup 静态及可能脚本统计；Options/action catalog 仍分离。机制见 [first-frame owner](../architecture/runtime.md#action-popup-first-frame)。

## §17 Implementation ownership and migration map

| Location | Target responsibility |
| --- | --- |
| `packages/contracts/src/control.contracts.ts` | 完整字段/操作、策略类别、意图/快照/ACK guards 统一词汇表 |
| `packages/contracts/src/spectra.bootstrap.ts` | 最小常驻协议常量、极简读回与 5 组默认快捷键映射 |
| `packages/features/audio-engine/src/audio-graph-router.ts` | Offscreen Capture 使用的稀疏图、参数 ACK 与订阅式分析器 |
| `src/background/control-coordinator.ts` | 生命周期/意图 writer actor 串行，短 snapshot publication lane 独立采纳有序物理事实；代际 Revision、唯一持久化/发布、补偿与 Capture 准入 |
| `src/background/control-coordinator-values.ts` | 无 Chrome/storage 副作用的 target scope、mutation、ACK、reset 与 session projection 纯值能力 |
| `src/background/control-coordinator-ack.ts` | 无副作用的完整 intent/operation ACK 身份准入；不能提交、持久化或发布 |
| `src/background/extension-invocation.ts` | 扩展调用来源身份、前景/目标文档绑定与陈旧文档拒绝 |
| `src/background/popup-visualizer-source.ts` | Popup 观察订阅的文档级租约；借用 coordinator 的串行队列与 snapshot，不持有 revision 写入权，不授予 Capture 准入 |
| `src/background/settings-value-normalization.ts` | Global/Hotkey/Site/Preset/Audio 的纯 canonical value 与旧数据修复 |
| `src/background/settings-repository.ts` | revision/CAS、容量、迁移元数据与 durable storage 事务 |
| `src/background/runtime-loader.ts` | 文档级重级 Runtime Lease 与 READY 握手 |
| `src/background/media-inventory.ts` | 一次读取的媒体标签页投影：Chrome 的 `audible` 与该文档自身的可播放媒体事实；不注入、不探测、无 pending 状态 |
| `src/background/media-inventory-runtime.ts` | 该投影的唯一实例；`spectra.tab.visible.list` 与 Popup 卡片数公告共用，避免第二份组合 |
| `src/background/media-facts.ts` | session 内单文档媒体事实、reportRevision 高水位、使用记录单调合并与 hydration tombstone；跨 worker 水合，随导航/关闭退役，资格到期不删除 |
| `src/shared/media-card-policy.ts` | Background、Popup forecast 与数量公告共用的动态成员/availability/nextExpiryAt/expiryByTab 纯策略；匿名截止时间使关闭期间过期的 slot 在首帧前排除；无固定名额、无网页探测 |
| `src/shared/media-presence.ts` | “可控制媒体”的唯一可执行定义（readyState/currentTime/played），bootstrap 与重级 runtime 共用 |
| `src/background/popup-frame.ts` | 公告卡片数及非敏感外观；设置 RPC 在 global ACK 前等待当前 active tabs 的立即公告尝试，媒体报告仍合并；按 tab 代际防迟到覆盖，失败退回未公告状态 |
| `src/background/popup-control-port.ts` + `src/shared/popup-control-port.ts` | 连续 Popup 控制的唯一私有端口：严格 guard、每字段 latest slot、合并后调用同一 coordinator；不拥有第二个状态 owner |
| `src/background/audio-session-store.ts` | 每文档音频会话快照的 durable owner：文档 fence、250ms 合并写、最多 5 次重试、有界拒绝账本 |
| `src/shared/popup-bootstrap.ts` + `public/frame-reserve.js` | Popup 外观参数、主题键、surface 标记与 600px 上限的唯一契约；head script 提交主题/surface，不按历史高度 reserve |
| `src/popup-first-paint.ts` + `src/shared/i18n/popup-catalog.ts` | render-blocking deferred 独立 entry，复用规范模板与九种 Popup-only catalog；无身份 inert 结构原位绑定，模块同步初始化同一语言 |
| `src/background/main-runtime-manager.ts` | 幂等注入 Fullscreen V1 与 Page-Media V2 bridges |
| `src/content/core/media-registry.ts` | `mediaId`、`sourceRevision`、缓存可见性、Sticky Active Target 与 observation owner/epoch/selection/revision；导出与 bootstrap 共用的 chooseInitialMedia |
| `src/content/logic/native-media-async.ts` | 唯一标准媒体异步 ACK：playing 使用物理稳定 getter，其它字段保留既有事件+getter；source cancellation 与 frame cadence cache |
| `src/content/logic/native-media-executor.ts` | 精确 source ownership、page fallback/rollback、document desired 与有界 scene speed；mediaRestore token 取消旧 replay；不复制 async writer |
| `src/content/logic/native-write-policy.ts` | 每站点 `optimistic`/`verified` 策略与 drift 降级阈值：证明会回滚写入的站点被降级为“先证明后作答” |
| `src/content/logic/native-write-confirmation.ts` | 稳定化证明的独立注册表：写由 executor 拥有，证明脱钩于控制路径，可取消且不阻塞作答 |
| `src/content/logic/native-write-telemetry.ts` | 有界的本地 write-to-landed / landed-to-confirmed 延迟记录；不导出页面身份 |
| `src/content/video/video-effects-controller.ts` | 媒体 Keyed CSS / Overlay 归属与属性恢复 |
| `src/content/video/ab-loop.ts`, `time-marker.ts` | 媒体 Keyed A/B 循环与 Marker 算法及 disposer |
| `src/background/handlers/screenshot.ts` | 令牌校验、可见标签页截屏、裁剪与下载确认编排 |
| `src/popup/ui-event-hub.ts` | Popup 唯一 Chrome runtime listener、按 tab fan-out 与 subscriber failure isolation |
| `src/popup/control-snapshot-order.ts` | generation-first identity admission 与 same-generation revision 单调性 |
| `src/popup/bounded-card-bootstrap.ts` | cap-4 all-settled observation worker；全部成员节点先同步建立，cap 不影响展示数量，失败隔离后统一 badge/empty reconciliation |
| `src/popup/frame-height.ts` | 唯一 live frame 几何 owner：跟随完整结构的固有高度、600px cap 与单滚动面；observer 合并 rAF，取消和 revision fence，不等 actual 水合 |
| `src/popup/settings-forecast.ts` | 上次已提交 `GlobalSettings` 的首帧预测；读取时校验，首次权威投影覆盖，从不合并 |
| `src/popup/media-inventory-from-storage.ts` | session media facts 与 Chrome evidence 经 shared policy 投影首份列表，避免 service-worker 往返；RPC 对账，无第二份 retention 规则 |
| `src/remote/operation-queue.ts` | Remote 每 key 有界串行队列；不拥有 session/auth/protocol 状态 |
| `src/background/remote-sender-gate.ts` | “哪个本文档可以读远程会话状态”的唯一判定：精确文档路径集合，禁止 origin 前缀，缺 `sender.url` 即拒绝 |
| `src/shared/optional-permission-admission.ts` + `src/shared/optional-permission-click-gate.ts` | 可选权限的唯一手势入口与续体所有权；`request()` 必须是处理器首个异步调用，运行时消费者只读 `contains()` |
| `packages/nexus-kernel/src/diagnostics.ts` + `src/background/diagnostics.ts` + `src/options/diagnostics.ts` | 仅由 Options 手势触发的拉取式诊断：私有端口鉴权、标量事实、不可读 owner 报 `null`；不导出页面/标签/文档/请求身份，无诊断存储 owner |

结构拆分不得制造第二个 effect owner。协调者仍是 commit/persist/publish 唯一入口；
ACK 模块只做值验证。原生字段的相等判定由 `native-media-async.ts` 统一提供，
Executor 不再维护第二份数值/结构比较实现。产物调整必须在同一功能和探测负载下
比较真实 metafile closure；现有硬预算不可上调，零字节或把内容移到另一统计桶不算优化。

## §18 Cross-world bridges

两个 Bridge 均为 manifest `document_start` 注册，由 `main-runtime-manager.ts` 幂等重注入:
- `__SPECTRA_FULLSCREEN_BRIDGE_V1__`: 仅包装原生 `requestFullscreen()` 入口以在 1.2s 内协调增强音频交接。
- `__SPECTRA_PAGE_MEDIA_BRIDGE_V2__`: 仅对 `volumeBase`、`mediaMuted` 与 `speed` 发起同步 DOM 事件并在请求元素上读回，不维持轮询与全局拦截。
