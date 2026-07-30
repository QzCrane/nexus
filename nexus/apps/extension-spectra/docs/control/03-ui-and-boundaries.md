---
type: reference
status: stable
audience: developer
last_reviewed: 2026-07-26
---

# 03. UI & Boundaries (Visualizer, favicon, remote, UX)

> 主题 owner 段: §7 UI, visualizer, favicon and remote boundaries · §19 User experience
> 完整目录: [README.md](README.md)

## §7 UI, visualizer, favicon and remote boundaries

- 所有 UI 文本/Tooltip/状态/Reset 行为统一使用 canonical locale key 映射（缺失走可观测英文 fallback）。
- Reset 写入字面 `volume=1` 与 `rate=1`；恢复网页原始值为单独的 restore 操作。
- **Visualizer 订阅**: 依附于已激活的处理器，拥有代际感知 lease。采样仅在 `AudioSessionSnapshot` ACK 为 `phase: active` (WebAudio/Capture) 时以最高 15 Hz 允许，无激活处理器时保持平坦并不发 IPC。
- Favicon 走标准 URL/service 机制，禁止未知 `_favicon` 权限。远程 QR 图显式生成本地 `data:`/SVG URL。

### §7.1 Strategy admission and performance gates

由 `CONTROL_STRATEGY_RULES` 执行准入校验:

| Strategy | Required proof before selection | Idle/runtime cost | Disallowed escalation |
| --- | --- | --- | --- |
| `observe` | 权威 getter/事件，或已激活处理器的订阅 | 0 | 读操作不建 runtime/AudioContext/offscreen/MAIN |
| `dom-native` | 标准单元素 API，目标身份与读回 | 写/事件 | 不 patch 原型描述符，不绕过 user activation |
| `chrome-native` | Chrome API 匹配且 Chrome getter/事件确认 | 命令/事件 | 在 `tabs.get`/事件确认前不乐观响应 |
| `extension-state` | 属于 SPECTRA 且绑定文档/媒体/源码 | 0 (未拥有) | 不伪装为原生状态 |
| `extension-css` | 扩展属性/变量，计算样式读回 | 0 (中性) | 不覆盖或恢复猜测的内联样式 |
| `extension-overlay` | 扩展 shadow host，几何读回 | 合并 rAF (仅可见) | 不改变目标 `position`/`z-index` 或伪造焦点 |
| `media-webaudio` | 绑定前证明资源合规，完全覆盖与图可读 | 1 惰性文档上下文 | 未知 CORS/静音/DRM/受阻媒体不可作为 probe |
| `capture` | 显式意图、权限/激活、offscreen 候选与归一化 ACK | 1 惰性 offscreen 处理器 | 不由 status 读激活，提交前不替代稳定路径 |
| `unsupported` | 较低侵入策略全部失败 | 0 | 保持页面原状并返回结构化错误 |

### §7.2 Production loading topology and bundle ownership

- Manifest 仅注入 `content-bootstrap.js`（基于轻量 `@nexus/contracts/bootstrap`）。
- 完整 `content-runtime.js` 通过 READY 事务惰性加载。
- `sideEffects: false` 在 `@nexus/contracts`、`audio-engine` 与 `kernel` 启用，确保构建 Tree-Shaking。
- 所有产物打包禁止二次 Terser Pass；单一 esbuild 生产构建负责压缩与命名混淆。

### §7.3 Failure-directed escalation

由 `CONTROL_RETRYABLE_STRATEGY_FAILURES` / `CONTROL_TERMINAL_STRATEGY_FAILURES` 控制:

| Failure class | Codes | Decision |
| --- | --- | --- |
| capability gap | `capability-unavailable`, `write-unsupported`, `readback-mismatch`, `coverage-incomplete`, `source-binding-ineligible`, `strategy-runtime-failed` | 释放/绕过失败候选，尝试下一个可用策略 |
| browser/security boundary | `user-activation-required`, `permission-denied`, `cors-or-drm-protected`, `protected-content`, `closed-shadow-inaccessible`, `stale-document`, `stale-media-source`, `policy-denied` | 终止。返回结构化错误并保持稳定路径（严禁用 MAIN/Capture 伪装） |

## §19 User experience

- 主面板展示音量/静音/倍速/播放与目标媒体。Boost 与 DSP 为高级控制。
- 颜色与实际状态一比一对应: `blue` 表示 Native / WebAudio ACK，`purple` 表示明确的 Capture active ACK，`gray` 表示静音/0。
- Badge 在 `chrome.storage.session` 中记录 per-tab 插件使用事实；完全无控制的空白标签页保持 Badge 为空。
- Toast 与 OSD 在全屏模式下自动挂载到 Popover top-layer 避免被全屏覆盖。
