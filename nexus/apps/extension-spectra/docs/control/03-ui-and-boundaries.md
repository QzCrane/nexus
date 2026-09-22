---
type: reference
status: stable
audience: developer
last_reviewed: 2026-08-28
---

# 03. UI & Boundaries (Visualizer, favicon, remote, UX)

> 主题 owner 段: §7 UI, visualizer, favicon and remote boundaries · §19 User experience
> 完整目录: [README.md](README.md)

## §7 UI, visualizer, favicon and remote boundaries

- 所有 UI 文本/Tooltip/状态/Reset 行为统一使用 canonical locale key 映射（缺失走可观测英文 fallback）。
- Reset 写入字面 `volume=1` 与 `rate=1`；恢复网页原始值为单独的 restore 操作。
- **Visualizer 订阅**: 仅可见、启用、未静音的前台主卡可声明精确活动标签页的分析 demand。Background 重新确认可信 Popup、当前活动标签页与精确顶层文档；完整安全的媒体覆盖可使用已 ACK 的 MediaElement WebAudio analyser，也可观察非中性 DSP 已经需要的 Capture。订阅不能创建 Capture admission 或保留中性 Capture；不安全的中性页面稳定为 bypass、返回空帧，不重试获取 Capture。后台卡片只能消费已有处理器；采样必须等待 `actualMode: webaudio | capture` 且 `phase: active` 的精确 ACK，最高 15 Hz。隐藏、失焦、关闭、导航、断连、超时或最终 subscriber 释放都会退役临时 demand；独立 DSP demand 不受影响。
- **Popup 高度**: 主视图使用内容固有高度；只有 Settings 导航模式为容器施加 600px 滚动视口。CSS 是唯一尺寸 owner，导航只切换模式类，禁止读取 `offsetHeight` 后写 inline `min-height` 或调用 `resizeTo`。
- Favicon 走标准 URL/service 机制，禁止未知 `_favicon` 权限。远程 QR 图显式生成本地 `data:`/SVG URL。

### §7.1 Strategy admission and performance gates

由 `CONTROL_STRATEGY_RULES` 执行准入校验:

| Strategy | Required proof before selection | Idle/runtime cost | Disallowed escalation |
| --- | --- | --- | --- |
| `observe` | 权威 getter/事件 | 0 | 读操作不建 runtime/处理器上下文/offscreen/MAIN |
| `capture-observe` | 可信 Popup、可见前台主卡、活动精确文档、一次性 Capture admission 与 active ACK | 订阅期一个惰性 offscreen Capture | 禁止把后台卡/status read 升级为 Capture，禁止持久化 demand 或创建页面音频图 |
| `dom-native` | 标准单元素 API，目标身份与读回 | 写/事件 | 不 patch 原型描述符，不绕过 user activation |
| `chrome-native` | Chrome API 匹配且 Chrome getter/事件确认 | 命令/事件 | 在 `tabs.get`/事件确认前不乐观响应 |
| `extension-state` | 属于 SPECTRA 且绑定文档/媒体/源码 | 0 (未拥有) | 不伪装为原生状态 |
| `extension-css` | 扩展属性/变量，计算样式读回 | 0 (中性) | 不覆盖或恢复猜测的内联样式 |
| `extension-overlay` | 扩展 shadow host，几何读回 | 合并 rAF (仅可见) | 不改变目标 `position`/`z-index` 或伪造焦点 |
| `media-webaudio` | 完整精确源覆盖、绑定安全性与 running/readback ACK | 拥有期一个页面媒体图 | 不部分绑定，不猜测 CORS，不获取 tab stream |
| `capture` | 显式意图、权限/激活、offscreen 候选与归一化 ACK | 1 惰性 offscreen 处理器 | 不由 status 读激活，提交前不替代稳定路径；Content 不创建 Capture 节点 |
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
- 颜色与已确认的用户结果一比一对应: `blue` 表示非 Capture 路径已 ACK（原生或 MediaElement WebAudio），`purple` 仅表示明确的 Capture active ACK，`gray` 表示静音/0。表面不得把 `blue` 解释成物理处理器类型。
- 连续数值控制在输入任务中显示最新请求值；音量跨过 100% 不冻结数字、滑块或 OSD，也不推断处理器切换。颜色继续消费已确认生命周期，旧 ACK 不覆盖新目标，当前请求失败则回到已确认值并显示错误。Popup、快捷键和滚轮遵守同一规则。
- 快捷键手势在按住和松键冻结阶段都保留最新同手势 actual ACK；按住时不回退预测数字，松键并结算后只纠正到最后实际值。最后 ACK 先于 keyup 到达时也必须完成纠正，不能等待一个不会再来的 ACK；新手势始终隔离旧手势结果。
- 连续音量与 DSP 意图按配置字段和输入 revision 跟踪 pending；旧快照不得覆盖这些字段的最新请求值，其他已 ACK 字段仍正常同步。ACK 与广播共用文档、generation 和 revision 顺序规则；settlement 仅清除本次覆盖的输入，导航替换完整投影。
- Effects 使用显式按钮进入，`Enter` 确认、`Escape` 返回且恢复触发焦点；Preset 清空与应用各自使用一次原子 patch/一个 revision，busy 期间等待权威 ACK，确认预览使用语义化 `<dl>`。
- Popup 关闭前的最后用户意图必须已由存活的 Background owner 接收；不得把交付可靠性寄托在正在销毁的 UI realm continuation。
- Remote 操作 busy 时不得被关闭或重复提交，失败后保留可重试状态；Options 校验使用行内可访问错误，危险操作使用产品化原生 dialog，九种 locale 共享同一语义契约。
- Badge 在 `chrome.storage.session` 中记录 per-tab 插件使用事实；完全无控制的空白标签页保持 Badge 为空。
- Toast 与 OSD 在全屏模式下自动挂载到 Popover top-layer 避免被全屏覆盖。
- Popup 离散控制与合并后的 Filter 写入都必须把结构化失败投影为可访问错误 Toast；失败清除待发送值、先回滚到最后一次 ACK，再强制读取 authoritative snapshot，不得被吞掉或继续呈现为成功状态。
- Options 只有在权威 settings snapshot 成功读取后才渲染持久化事实。启动或 mutation 失败使用统一页面错误面和明确的 Retry reload；不允许把 `DEFAULT_*` 伪装成已保存状态，失败 mutation 必须回滚或强制重读。
