---
type: explanation
status: stable
audience: contributor
last_reviewed: 2026-11-09
---

# 01. State & ownership (EPR-001..009)

> 主题 owner: 工程原则中的状态、所有权、ready 屏障、唯一写者、策略顺序与路由。
> 完整目录: [engineering/README.md](../engineering/README.md)

## EPR-001: 单一事实源 (SSOT)
- 每个领域只能有一个 authority: Contracts 管协议，Background coordinator 管控制，`ControlSnapshot` 管字段实际值，`AudioSessionSnapshot` 管处理器生命周期，Manifest/Registry 管 HALO 插件元数据。
- UI、缓存、Badge、远程端与兼容层均为 projection/transport/adapter，不得自建第二权威状态；旧别名必须只读并附带删除版本。

## EPR-002: Desired / Actual / ACK / Snapshot / UI 预测分层
`desired intent -> native/runtime actual -> acknowledged actual -> authority snapshot -> ui projection`
- 请求值/storage 写入/setter 返回均非 ACK。必须经由事件/getter/处理器实际读回并完成 identity/generation/revision 校验才算 ACK。Optimistic UI 仅限发送窗口，收到 ACK 确认、失败回滚。

## EPR-003: ACK 必须绑定身份与代际
可写操作绑定 `tabId + documentId + origin + generation`；媒体控制身份追加 `frameId + mediaId`，`sourceRevision` 只界定资源作用域（读回基线、恢复义务、呈现状态），同一元素换流走重基与重校验而不是丢弃在途写入；元素离场即控制身份退役，同一文档同一 `kind` 的当前选中目标继任它，携带已退役身份的请求解析到继任者，在途写入对退役身份只重试一次；控制事务绑定 `revision + intentId`。旧文档/媒体/processor generation 的迟到结果直接丢弃。

## EPR-004: READY 是能力屏障
完成身份绑定、消息监听、媒体发现、初始 actual 同步、配置恢复、首次策略应用及 WebAudio/Capture ACK 后方可发布 `ready`（否则为 `initializing`/`degraded`/`failed`）。Background READY 缓存仅为优化，健康探测/dispose/导航/热更新须使其失效。

## EPR-005: 单文档唯一可写 Runtime
生命周期: `ABSENT -> LOADING -> INITIALIZING -> READY -> DISPOSING -> ABSENT`。热更新禁止新旧实例同时写入 DOM/Snapshot/处理器。消费端使用 token/lease，末个 token 释放资源。

## EPR-006: 目标 `{document, media, field}` 唯一 Writer
标准媒体属性归唯一 `NativeMediaExecutor`；站点 API 仅为 DOM 失败后的单次 allowlisted adapter；CSS/Overlay/Chrome API/WebAudio/Capture 均有明确 owner 与 disposer。严禁隐式 echo、永驻 bridge 或通用 MAIN patch。

## EPR-007: 按能力 Native-First 策略
策略顺序: `observe -> exact DOM/Chrome native -> one-shot official site API -> reversible augmentation -> structured unsupported`
- 原生能力（音量/静音/倍速/播放/seek/loop/PiP/fullscreen）保持原生边界；无等价原生能力时（Boost/EQ/Bass/Compressor/Mono/Pan/Delay）才申请处理器。

## EPR-008: Capture 为按需末端路径
Capture 仅服务明确 full-output DSP 或安全 WebAudio 无法覆盖的场景。状态读取、原生控制与缓存均不得启动 Capture。候选处理器需在闭合 gate 下创建/读回实际配置后切换，失败则恢复稳定路径。

## EPR-009: 网站一元路径映射
缓存模型: `{ domain, fingerprint: 'site:${string}', route: 'direct' | 'capture', source: 'user' | 'auto', updatedAt }`
- 规范化网站仅一个 route (`site:*` 为唯一持久化身份)。自动观察更新不覆盖用户固定路径；颜色与 UI 仅读取当前实际 ACK；视频实例与 `currentSrc` 变更不增加持久化列表行。

## EPR-002a: 写入与证明分离（规则见 05 §11.1）
物理写入与稳定证明是两个事实，但**哪些字段可以先答 `written`** 由
[05 §11.1 Native write proof state](../../apps/extension-spectra/docs/control/05-control-state.md#native-write-proof-state)
的准入表唯一决定；本原则只保留结论，不复制字段清单。

- 只有合格的标准 DOM `volumeBase` / `mediaMuted` 可以分开作答。
- `speed`、`playing`、page-controller 写入与处理器输出，始终在同一事务内等待证明。
- 两份清单一旦漂移，实现会按错的那份写；所以这里没有清单。

## EPR-006a: 投影元素单一写者
同一投影元素（卡片的填充条、读数、原生滑块）在**同一个投影面内**只能由一个模块写入。两个写者时后执行的静默获胜，表现为填充条落后于拇指或一帧闪回。
- 卡片的音量投影写入集中在 `popup/card/volume-view.ts`；帧合并渲染与指针直绘都通过它。
- 投影面之间（card / side-panel / content OSD）不得互相 import，见 `architecture-layers.json`。
- 机械化：`scripts/verify/check-ui-authority.ts` 的 UI-004 与 `scripts/verify/check-architecture-layers.ts` 的 LAYER-001。
