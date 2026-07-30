---
type: explanation
status: stable
audience: contributor
last_reviewed: 2026-07-30
---

# 02. Operations & safety (EPR-010..018)

> 主题 owner: 不可逆操作准入、观察投影、控制事务串行、媒体语义、事件归因、生命周期、快捷键反馈、UI 契约、动态频谱。
> 完整目录: [engineering/README.md](../engineering/README.md)

## EPR-010: 不可逆操作先证明准入
`createMediaElementSource()`、Capture、外部网络、权限与 user activation 跨越不可逆/平台约束边界前，必须先收集同一元素/来源的完整证据。CORS、DRM、受保护媒体、闭合 Shadow DOM、权限拒绝与过期 activation 为终止错误，不得猜测或扩大范围。

## EPR-011: 观察纯投影与显式提交
纯 status/read 禁止安装 listener、扫描文档、改变 active target、写设置、增加 revision、申请 Runtime/MAIN/offscreen 或生成合成事件。页面真实事件成为 authority 必须显式执行 `read -> compare -> revision + 1 -> persist -> publish`。

## EPR-012: 控制事务串行与独立失败隔离
Background 为唯一串行入口，执行 `校验 identity/revision -> 拆分 execution units -> 校验 ACK -> 补偿 -> 提交 -> 持久化/广播`。除非契约规定原子性，单个字段失败须保留自身 rollback 与结构化错误，不得吞没其他字段（如倍速失败不吞 EQ，PiP 失败不阻止音量）。

## EPR-013: 选择、恢复、观察语义分离
- `MediaRegistry` 记录候选事实，`SelectionEngine` 依据明确证据（用户交互/真实页面控制/PiP/fullscreen owner/播放/稳定可见性）选择目标。
- Restore replay、扩展自写事件、marker seek 与非活动媒体加载不得抢占 active target。
- `activeMedia` 与 `activeVideo` 相互独立，互不污染。

## EPR-014: 页面事件先归因再选目标
事件需归因分类（页面交互/扩展写入/扩展恢复/扩展 seek/浏览器生命周期/未知），扩展生成的 `volumechange`/`ratechange`/`seeked` 禁止伪装成用户选择。页面真实观察仅提交一次 actual，禁止二次回写 DOM。

## EPR-015: 原生 API 生命周期边界不可绕过
PiP 与 fullscreen 严格走标准 API、真实 user activation、生命周期事件与 getter。"恢复"须针对真实 `activeVideo`/`pictureInPictureElement`；全屏切换禁止改变音量制造激活；处理器 handoff 须保存并恢复页面 baseline。

## EPR-016: 快捷键与反馈显式生命周期
- 新文档首次快捷键自动完成 identity-bound Runtime ensure。
- 快捷键 target 可设置/取消并校验 tab/document；长按仅在按下/重复/松开边界内触发，松开取消 pending repeat/timer。
- Toast 仅由明确快捷键/操作 intent 触发（初始化/刷新/普通 Popup 打开不触发）。每个 hotkey 仅一个 feedback owner。

## EPR-017: UI 契约与明确恢复语义
- 按钮/Tooltip/状态/无障碍名称统一使用 canonical i18n key，缺失走可观测英文 fallback。
- Reset 语义: `100%` / `1x` 为字面控制值；恢复网页原始值为单独的 restore-page-settings 操作。
- Favicon 走标准 URL/service 规则，禁止未声明权限或将获取失败转为 unhandled rejection。

## EPR-018: 动态频谱仅消费现有处理器
频谱订阅仅建立在已 ACK 为 active 的处理器上（独立 generation-aware lease，上限 15 Hz，不可见/关闭立即释放）。无 active processor 时严禁创建 AudioContext、analyser、Capture 或隐藏 IPC。
