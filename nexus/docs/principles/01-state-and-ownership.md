---
type: explanation
status: stable
audience: contributor
last_reviewed: 2026-07-30
---

# 01. State & ownership (EPR-001..009)

> 主题 owner: 工程原则中的状态、所有权、ready 屏障、唯一写者、策略顺序与路由。
> 完整目录: [engineering/README.md](../engineering/README.md)

## EPR-001: 单一事实源 (SSOT)

- 每个领域必须有一个 authority:Contracts 管协议形状,Background coordinator 管控制提交,`ControlSnapshot` 管字段实际值,`AudioSessionSnapshot` 只管处理器生命周期,Manifest/Registry 管 HALO 插件元数据。
- UI、缓存、Badge、远程端和兼容层都是 projection、transport 或 adapter,不能自行发明第二份权威状态。
- 同一概念只保留一个字段语义。旧别名只能只读迁移,并必须有删除版本。

## EPR-002: Desired、Actual、ACK、Snapshot、UI 预测必须分层

```text
desired intent -> native/runtime actual -> acknowledged actual -> authority snapshot -> ui projection
```

- 请求值不是成功值。
- setter 返回、storage 写入、处理器接受请求都不是 ACK。
- 只有事件/getter/处理器实际读回,并通过 identity、generation、revision 校验,才能形成 ACK。
- Optimistic UI 只能存在于短暂发送窗口,收到 ACK 后确认,失败后回滚。

## EPR-003: 每个 ACK 都必须绑定身份和代际

任何可写操作至少绑定 `tabId + documentId + origin + generation`;媒体操作还绑定 `frameId + mediaId + sourceRevision`;控制事务绑定 `revision + intentId`。旧文档、旧媒体源、旧 processor generation 的迟到结果必须丢弃,不能更新新页面。

## EPR-004: READY 是能力屏障

Runtime 只有完成身份绑定、注册消息处理、媒体发现、初始 actual 同步、配置恢复、首次策略应用和 WebAudio/Capture 最终 ACK 后,才能发布 `ready`。初始化期间只能发布 `initializing`、`degraded` 或 `failed`。Background 的 READY 缓存只是优化,健康探测、dispose、导航、热更新或 context invalidation 都必须使其失效。

## EPR-005: 同一文档只能有一个可写 Runtime

Runtime 生命周期固定为 `ABSENT -> LOADING -> INITIALIZING -> READY -> DISPOSING -> ABSENT`。热更新允许旧实例销毁,但不能让旧、新实例同时写 DOM、Snapshot 或处理器。每个 consumer 使用 token/lease,只有最后一个 token 释放资源。

## EPR-006: 每个 `{document, media, field}` 只有一个 writer

标准媒体属性集中在唯一 `NativeMediaExecutor`;站点官方 API 只能作为 DOM 读回失败后的单次、 allowlisted adapter;CSS、Overlay、Chrome API、WebAudio 和 Capture 各自有明确 owner 与 disposer。禁止第二个 writer、隐式 echo、永驻 page bridge 和通用 MAIN monkey-patch。

## EPR-007: 按能力 native-first,不按整页模式决策

策略顺序固定为:

```text
observe -> exact DOM/Chrome native -> one-shot official site API -> reversible augmentation -> structured unsupported
```

音量、静音、倍速、播放、seek、loop、PiP、fullscreen 等保持原生边界;Boost、EQ、Bass、Compressor、Mono、Pan、Delay 等没有等价原生能力时才申请处理器。用户界面展示结果,不要求用户选择 Native/WebAudio/Capture。

## EPR-008: Capture 是按需的最后处理路径

Capture 只服务明确的 full-output DSP 或确实无法由安全 WebAudio 覆盖的处理需求。状态读取、普通原生音量、静音、倍速、播放、PiP、fullscreen 和仅存在缓存成员都不能启动 Capture。候选处理器必须在关闭 gate 下创建、读回实际配置后再切换;失败时恢复上一个稳定路径。

## EPR-009: 每个网站只映射一个路径

媒体能力缓存的最小模型是:

```ts
{ domain, fingerprint: `site:${string}`, route: 'direct' | 'capture', source: 'user' | 'auto', updatedAt }
```

- 一个规范化网站只能有一个 route,不维护"安全列表"和"劫持列表"两份能力结构。
- `site:*` 是唯一持久化身份;`media:v1:*` 仅用于旧版本兼容读取,并在迁移时按域名折叠。
- 自动观察更新已有网站路径,不能覆盖用户固定路径;当前明确 ACK 可以纠正自动缓存。
- 缓存选择路径,不代表路径已激活;颜色和 UI 只能读取当前实际 ACK。
- 视频实例、`currentSrc` 变化和页面媒体数量只属于当前文档内存状态,永远不增加持久化列表行。
