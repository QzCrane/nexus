---
type: explanation
status: stable
audience: contributor
---

# 02. Operations & safety (EPR-010..018)

> 主题 owner: 不可逆操作准入、观察投影、控制事务串行、媒体语义、事件归因、生命周期、快捷键反馈、UI 契约、动态频谱。
> 完整目录: [engineering-principles.md](../engineering-principles.md)

## EPR-010: 不可逆操作先证明准入

`createMediaElementSource()`、Capture、外部网络、权限和 user activation 都可能跨过不可逆或受平台约束的边界。必须先收集同一元素/来源的完整证据,再绑定资源。CORS、DRM、受保护媒体、闭合 Shadow DOM、权限拒绝和过期 activation 是终止错误,不是继续猜测或扩大范围的理由。

## EPR-011: 观察是纯投影,观察提交必须显式

纯 status/read 不能安装 listener、扫描文档、改变 active target、写设置、增加 revision、申请 Runtime/MAIN/offscreen 或生成合成事件。若页面真实事件要成为 authority,必须显式执行 `read -> compare -> revision + 1 -> persist -> publish` 的 observation commit。

## EPR-012: 控制事务串行,但字段失败互不吞没

Background 是所有页面、Popup、热键和远程操作的唯一串行入口。事务读取 authority、校验 identity/revision、拆分 execution units、校验每个 ACK、执行补偿、提交 changed fields、持久化并广播。除非契约明确原子性,倍速失败不能吞掉 EQ,PiP 失败不能阻止音量,单个字段失败必须有自己的 rollback 和结构化错误。

## EPR-013: 选择、恢复、观察三种语义分离

- `MediaRegistry` 记录候选事实,`SelectionEngine` 根据明确证据选择目标。
- 用户交互、真实页面控制、PiP/fullscreen owner、播放和稳定可见性才是选择证据。
- restore replay、扩展自写事件、marker seek 和非活动媒体加载不能抢占 active target。
- `activeMedia` 与 `activeVideo` 独立;音频元素不能清除视频目标,视频操作也不能偷换音频目标。

## EPR-014: 页面事件必须先归因再选目标

事件先分类为页面交互、扩展写入、扩展恢复、扩展 seek、浏览器生命周期或未知来源,再应用 selection policy。扩展产生的 `volumechange`、`ratechange`、`seeked` 不能伪装成用户选择。页面真实观察只能提交一次 actual,不得回写第二次 DOM。

## EPR-015: 原生 API 的生命周期边界不能被模拟绕过

PiP 和 fullscreen 只走标准 API、真实 user activation、生命周期事件和 getter。PiP 的"恢复"必须针对真实 `activeVideo`/`pictureInPictureElement`,不能依赖网站页面猜测、第二次提示、通用 MAIN 或 Capture。全屏切换不能通过改变页面音量制造激活;处理器 handoff 必须保存并恢复页面拥有的 baseline。

## EPR-016: 快捷键与反馈是显式生命周期

- 新文档第一次快捷键必须先完成 identity-bound Runtime ensure,不能要求用户先打开 Popup。
- 快捷键 target 必须可设置、取消和校验 tab/document;焦点标签页信息只作为明确的反馈上下文。
- 长按只在按下、重复、松开三个边界内产生动作;松开后取消 pending repeat、toast 惯性和 timer。
- Toast 只能由明确的快捷键/操作 intent 触发;页面刷新、Runtime 初始化、普通 Popup 打开和状态同步不能自动弹出。
- 特殊 target toast 使用标准 Toast 视觉系统,只增加焦点标签页信息;音量条、消失时间和反馈 owner 必须与普通 Toast 一致。
- 每个 hotkey 只有一个 feedback owner,避免 OSD、语义 handler 和通用 listener 重复反馈。

## EPR-017: UI 文本、Tooltip、图标和状态必须有契约

- 所有按钮、Tooltip、状态变化和无障碍名称使用 canonical i18n key;缺 key 只能走可观测英文 fallback,不能渲染 `undefined`。
- 顶部按钮、选项卡按钮、reset/restore 按钮和动态状态都要纳入 locale completeness 测试。
- Reset 的产品语义必须明确:`100%` 和 `1x` 是真实控制值;恢复网页原始值是单独的 restore-page-settings 操作,不能混为"释放控制"。
- Favicon 使用浏览器支持的 favicon 服务/URL 生成规则,不声明未知 `_favicon` 权限,也不把获取图标失败转成未捕获 Promise。

## EPR-018: 动态频谱只消费现有处理器

频谱订阅只能建立在已经 ACK 为 active 的处理器上。每个 Popup 是独立 generation-aware lease,最多一个 in-flight batch,采样上限 15 Hz;隐藏、不可见、关闭或异常退出立即释放 lease。没有 active processor 时不得创建 AudioContext、analyser、Capture 或隐藏 IPC。
