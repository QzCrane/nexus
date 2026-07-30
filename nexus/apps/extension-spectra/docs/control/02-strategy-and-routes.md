---
type: reference
status: stable
audience: developer
last_reviewed: 2026-07-26
---

# 02. Strategy order & Routes (Capability order, registry, runtime, bridges)

> 主题 owner 段: §3 Strategy order · §4 Site route registry · §5 Runtime ownership · §6 Exact-element page media, PiP & fullscreen
> 完整目录: [README.md](README.md)
>
> **TL;DR**: planner 按 `observe -> native -> controlled-augmentation -> unsupported` 顺序选策略；site route 为路由提示而非强制激活；五组内置快捷键在 `document_start` 独占；Capture 仅在 invocation-bound admission 下激活。

## §3 Strategy order

Planner 过滤无法覆盖请求范围或无法读回 actual 的候选者，随后遵循特定能力固有顺序:

```text
OBSERVE -> CAPABILITY-SPECIFIC NATIVE (PAGE_NATIVE / DOM_NATIVE / CHROME_NATIVE) -> CONTROLLED AUGMENTATION (EXTENSION_STATE / CSS / OVERLAY / SAFE_MEDIA_WEBAUDIO / CAPTURE) -> UNSUPPORTED
```

### §3.1 Forbidden generic MAIN behavior

生产代码严禁重定义或覆盖以下全局对象:
- `window.AudioContext` / `webkitAudioContext` / `AudioContext.prototype.destination` / `close`
- `window.Audio` / `document.createElement` / `createElementNS` / `HTMLMediaElement.prototype` / `History` API

MAIN 执行严格限定于 manifest `document_start` 注入的两个闭合 bridge:
1. Fullscreen V1 Bridge (`content-fullscreen-bridge.js`): 包装原生全屏入口以协调增强音频手势。
2. Page-Media V2 Bridge (`content-page-media-bridge.js`): 仅在目标元素上处理 `volumeBase`、`mediaMuted` 与 `speed`。

### §3.2 Native, augmentation and forbidden hijack

| Class | Strategies | Meaning |
| --- | --- | --- |
| observe | `observe` | 只读事件与 getter，无控制权。 |
| native | `page-native`, `dom-native`, `chrome-native` | 精确读回的原生 API/属性。`page-native` 仅通过 V2 bridge 准入。 |
| controlled augmentation | `extension-state`, `extension-css`, `extension-overlay`, `media-webaudio`, `capture` | 原生控制不可用时添加的可逆扩展能力（必须有明确 owner、readback、disposer 与 restore 规则）。 |
| unsupported | `unsupported` | 保持页面原状并返回结构化能力错误。 |

## §4 Site route registry and eligibility cache

Background 仓库持久化每个规范化网站的路由记录 (`SiteRouteRecord`)，内存策略决策按文档隔离:

```ts
type SiteRouteRecord = {
  domain: string;
  fingerprint: `site:${string}`;
  route: 'direct' | 'capture';
  source: 'user' | 'auto';
  updatedAt: number;
};
```

- **路由仲裁**: 用户固定路由 > 最新自动观察路由 > 默认原生 `direct` 路由。
- **降级与提升**: 旧版本 `media:v1:*` 自动折叠迁移。Popup/Options 与 Background 共享同一 `registry-v2` 列表。
- **Capture 激活门禁**: 缓存 `capture` 仅为路由提示，不提前开启 Offscreen/Processor/Purple Badge。仅当原生能力不足、显式需要全输出 DSP 且带有扩展调用的 `captureAdmission: 'extension-invocation'` 时方惰性激活。

### §4.1 Last-resort Capture fallback

当用户固定 `direct` 路由但遇到跨域媒体且配置显式要求 DSP (`volume > 100` 或非零 EQ/Bass/Compressor/Mono/Pan/Delay) 时，executor 将升轨至 Capture 避开 CORS 阻塞。
- 门禁词 `captureAdmission: 'extension-invocation'` 仅为当前激活标签页的 Popup 事务或校验通过的快捷键颁发（`ControlSubmitRequest` 拒收此字段）。
- ACK `active` 后，`recordActual` 以 `force: true` 覆盖更新注册表 (`markRegistryDomainProbed` → `spectra.registry.mark-probed` → `RegistryRepository.markProbed` → `addOrUpdateDomain`)，将条目更新为 `capture/auto`，以便后续文档直接以 `RESTRICTED` 路由加载。

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
