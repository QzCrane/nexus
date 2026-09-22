---
type: reference
status: stable
audience: developer
last_reviewed: 2026-07-26
---

# 02. Strategy order & Runtime (Capability order, runtime, bridges)

> 主题 owner 段: §3 Strategy order · §4 Capture admission · §5 Runtime ownership · §6 Exact-element page media, PiP & fullscreen
> 完整目录: [README.md](README.md)
>
> **TL;DR**: canonical policy 按 `observe -> native -> controlled-augmentation -> unsupported` 顺序选策略；处理器增强优先使用已证明完整覆盖的页面 WebAudio，必要时才使用有一次性 admission 的 Capture；五组内置快捷键在 `document_start` 独占。

## §3 Strategy order

`CONTROL_ALGORITHM_POLICIES` 过滤无法覆盖请求范围或无法读回 actual 的候选者，随后遵循特定能力固有顺序:

```text
OBSERVE -> CAPABILITY-SPECIFIC NATIVE (PAGE_NATIVE / DOM_NATIVE / CHROME_NATIVE) -> CONTROLLED AUGMENTATION (EXTENSION_STATE / CSS / OVERLAY / CAPTURE) -> UNSUPPORTED
```

### §3.1 Forbidden generic MAIN behavior

生产代码严禁重定义或覆盖以下全局对象:
- `window.AudioContext` / `webkitAudioContext` / `AudioContext.prototype.destination` / `close`
- `MediaElementAudioSourceNode` / `createMediaElementSource()` / `HTMLMediaElement` 的音频输出链路
- `window.Audio` / `document.createElement` / `createElementNS` / `HTMLMediaElement.prototype` / `History` API

MAIN 执行严格限定于 manifest `document_start` 注入的两个闭合 bridge:
1. Fullscreen V1 Bridge (`content-fullscreen-bridge.js`): 包装原生全屏入口以协调增强音频手势。
2. Page-Media V2 Bridge (`content-page-media-bridge.js`): 仅在目标元素上处理 `volumeBase`、`mediaMuted` 与 `speed`。

### §3.2 Native, augmentation and forbidden hijack

| Class | Strategies | Meaning |
| --- | --- | --- |
| observe | `observe` | 只读事件与 getter，无控制权。 |
| native | `page-native`, `dom-native`, `chrome-native` | 精确读回的原生 API/属性。`page-native` 仅通过 V2 bridge 准入。 |
| controlled augmentation | `extension-state`, `extension-css`, `extension-overlay`, `media-webaudio`, `capture` | 原生控制不可用时添加的可逆扩展能力（必须有明确 owner、readback、disposer 与 restore 规则）。处理器增强先使用完整可证明的页面图，否则才进入 Capture admission。 |
| unsupported | `unsupported` | 保持页面原状并返回结构化能力错误。 |

## §4 Capture admission and target identity

Capture 不是站点路由或状态探针，而是一次绑定当前顶层文档的扩展调用。Background 的 `CaptureAdmission` 是唯一激活凭据，内存状态按文档隔离:

```ts
type CaptureAdmission = {
  kind: 'capture-start' | 'capture-resume';
  document: { tabId: number; frameId: 0; documentId: string };
  documentEpoch: number;
  workerEpoch: string;
  expiresAtMonotonicMs: number;
  oneShot: true;
};
```

- **调用边界**: Popup 或经过校验的当前文档快捷键调用才可请求 `capture-start`；继续已有 Capture 只可使用其一次性 `capture-resume`。
- **消费边界**: admission 在 Content 请求到达 Background 时消费，错误、重放、过期、跨文档或导航 fence 均 fail-closed。
- **处理器边界**: Content 只提交 Capture intent；offscreen host 才能创建处理器，且仅在候选实际运行并返回归一化配置后发布 active。
- **目标边界**: `tabId + documentId + frameId: 0` 是处理器和快照身份；独立的 `hotkey-target-repository.ts` 只维护全局快捷键目标，不参与音频模式选择。

### §4.1 Three-owner processor admission

显式全音频 DSP 或前台 Visualizer 需要处理器时，`resolveDesiredAudioMode()` 在完整精确媒体覆盖下选择 `webaudio`，否则才选择 `capture`；中性且无观察需求时保持 `bypass`。`SettingsRepository` 持久化、`spectra.registry.*` v2 独立 Popup 投影的站点路由只改变候选选择：`direct` 禁止降级 Capture，`capture` 跳过页面图但仍必须携带一次性 admission，`auto` 使用上述最低成本顺序。严格的 `spectra.settings.*` v2 响应不含路由字段；Content 只经 sender-bound `spectra.audio.route.get/record` 查询或记录当前文档证据，不能命名其他站点，也不直接读写持久状态。

手动路由可以限定为 hostname，或限定为该 hostname 下的 canonical pathname 前缀。现有 hostname key 与 `spectra.registry.*` v2 domain-only shape 保持不变；`spectra.media-route.rules.*` 是 Popup-only 的完整规则投影，两者由同一个 `SettingsRepository`、revision 与容量边界持有。查询按最具体 hostname、再按最长路径段前缀选择；query 与 hash 不参与匹配，`/live` 不匹配 `/livestream`。自动检测只记录 hostname 级 advisory evidence，不从动态页面 URL 推断持久路径。Content 的路由读取始终由 Background 从 sender 当前 URL 派生；SPA 导航在 policy 串行队列中刷新规则，并清除上一页面的中性 processor hold，旧 Capture 因新规则为 `direct` 时必须退休。导航本身不能创建 Capture admission。
- MediaElement WebAudio 必须在首次不可逆绑定前证明所有当前 source 的同源/blob/data 或精确 preload-CORS 证据，并在 ACK 中返回 running context、graph signature、normalized actual config 与 source count。
- `captureAdmission` 只能随已验证的 extension-invocation intent 进入内部 coordinator，普通 `ControlSubmitRequest` 不能伪造该字段。
- host `active` ACK 必须同时证明 `tabId`、`generation`、`controlRevision`、`phase:'active'`、`contextState:'running'`、`graphSignature` 与 `normalizedActualConfig`；签名不匹配即拒收。
- Capture 停止必须收到 `phase:'idle'`、`contextState:'closed'`、`graphSignature:'none'` 和 `normalizedActualConfig:null`，否则保留错误状态与现有 owner，不得乐观释放。

### §4.2 SPECTRA extension envelope owner and V1 retirement

Content runtime 只有一个 SPECTRA envelope owner：`@nexus/contracts` 的
`SpectraRequestEnvelope` / `SpectraEventEnvelope` 类型与 runtime validators 定义
唯一 schema，`shared/spectra-client.ts` 定义通用 request transport。Popup、Options
等 focused client 只能携带这个 typed envelope，不能恢复另一套 action/router 协议；
document-start bootstrap 的最小请求边界也必须继续使用同一个
`SPECTRA_PROTOCOL_VERSION`，不能引入兼容分叉。

顶层 `action:` envelope 属于已退役的 V1 runtime，生产发送端禁止出现。快捷键
领域值 `payload.action` 是合法的 typed payload，不是 V1 envelope。`createRouter`、
`router.on`、`router.listen` 与 `GLOBAL_SETTINGS_UPDATE` 同样属于禁止的旧 runtime
路径；每个 listener 只接受其明确的 request/event type allowlist。扩展内部
envelope 当前为 v2；Remote 的 v3 是独立、带 session epoch 的外部线协议，二者
不能用同一个“v3”名称混淆。既有 v2 route 只允许保持 ABI 或新增 route，不允许
在同一 type 下替换 response shape。

## §5 Runtime, shortcut and feedback ownership

冷文档首个快捷键先完成 identity-bound Runtime ensure，等待 READY 屏障后提交，无需先打开 Popup。

### 五组默认快捷键 (document_start 独占)

| Chord | Action | Delta |
| --- | --- | --- |
| `Alt+ArrowLeft` | speed down | `-0.1` |
| `Alt+ArrowRight` | speed up | `+0.1` |
| `Alt+ArrowDown` | volume down | `-10` |
| `Alt+ArrowUp` | volume up | `+10` |
| `Alt+M` | toggle mute | 单次物理按压 |

- `Alt+Up` 注册为 Manifest 命令 `volume_up`（分派失败时由 Bootstrap 兜底）；其余四组由 Bootstrap 在 `document_start` capture 阶段做独占拦截 (`preventDefault` + `stopImmediatePropagation`)。
- 所有 `coalesce-20hz` 动作排除在可配置 Chrome command 槽之外。

### 网站自定义按键与 Toast 反馈
- 网站自定义按键遵循 **Website-First** 规则（原生 handler 优先）。
- Toast 仅由显式快捷键/操作触发，同一快捷键仅一个 feedback owner。全屏下 Toast 通过 Popover top-layer 挂载以避免被 DOM 全屏覆盖。

## §6 Exact-element page media, PiP and fullscreen

- `volumeBase`, `mediaMuted`, `speed` 严格遵循 `page-native -> dom-native` 顺序。
- V2 Bridge 限制在 12 层祖先与 96 个挂载属性内发现同步 controller，明确关联优先于距离。
- 页面 controller 必须具备成对 getter/setter 与稳定 readback。写入失败退回 DOM。
- PiP 与 Fullscreen 操作限制在当前 `activeVideo`，只能使用标准 API 与真实 user activation。
