# NEXUS 工程原则与 Markdown 文档索引

> 分析日期：2026-07-19
> 覆盖范围：仓库全部 46 个 Markdown 文件，共约 6,651 行。
> 目的：把历史回归、架构规范、隐私承诺、发布要求和规划文档收敛为一套可执行原则。

## 1. 结论先行

NEXUS 的共同工程主线是：单一事实源、明确所有权、真实 ACK、事件驱动、按需付费和可验证的生命周期。

SPECTRA 的控制问题必须按“字段/媒体/文档/运行时”建模，不能再用一个整页模式、两份互相冲突的站点列表或一份 UI 预测值代表全部状态。HALO 的工具问题必须按“清晰插件边界、Manifest/Registry SSOT、本地优先和原子生命周期”建模。发布和商店文案必须服从实际权限、网络流量和浏览器能力边界。

## 2. 文档权威层级

同一规则冲突时按以下顺序裁决：

1. `AGENTS.md`、`CLAUDE.md`、`rules.md`：仓库级工作流、安全、测试、依赖和 Git 约束。
2. SPECTRA `docs/control-architecture.md`：媒体、音频、视频、站点适配器和远程控制的唯一规范所有者。
3. SPECTRA `docs/protocols.md`、`docs/architecture.md`、`docs/remote-security.md`、`docs/cors-data-flow.md`：分别细化跨上下文协议、运行时所有权、远程认证和 WebAudio 来源准入；不得维护第二份策略矩阵。
4. SPECTRA `docs/bidirectional-sync-principles.md`、`docs/policy-decision.md`：入口索引，只引用上面的规范所有者。
5. `regression-recovery-*` 与 `optimization-review-*`：历史根因和发布证据，不是当前行为的规范所有者。
6. `plan.md`、市场调研、README、商店文案：规划、产品定位或对外说明，不能反向定义运行时行为。
7. `PRIVACY.md`、`store-listings/privacy-justifications.md`：隐私与权限申报；必须和实际发布包、远程站点及网络流量保持一致。

规则文档不应复制完整决策表。新规则只在唯一 owner 文档落一份，再从其他文档链接过去。

本文件自身是原则索引、文档地图和漂移检查清单，不是 SPECTRA 运行时的
第二个 owner。若本文件与 owner 文档出现行为描述差异，以对应 owner 文档
和已验证的 Contracts 为准；这里只保留可审计的原则编号与映射。

### SPECTRA 主题 owner

| 主题 | 唯一规范来源 | 其他文档允许保留的内容 |
| --- | --- | --- |
| 媒体策略、route、writer、ACK、Toast、快捷键、PiP/fullscreen、站点 adapter、UI 语义 | [`control-architecture.md`](../apps/extension-spectra/docs/control-architecture.md) | 链接、测试证据、历史复现 |
| 跨上下文 request/event/response、READY、lease 和边界 payload | [`protocols.md`](../apps/extension-spectra/docs/protocols.md) | 精确 wire 示例与兼容说明 |
| Context 所有权、加载拓扑、存储/缓存位置 | [`architecture.md`](../apps/extension-spectra/docs/architecture.md) | 组件地图与导航表 |
| 远程认证、HMAC、PeerJS/offscreen 会话 | [`remote-security.md`](../apps/extension-spectra/docs/remote-security.md) | 隐私披露和测试证据 |
| WebAudio 来源准入、CORS/DRM 终止边界 | [`cors-data-flow.md`](../apps/extension-spectra/docs/cors-data-flow.md) | 算法证据和回归测试 |
| 当前提交范围与历史测试结果 | [`development-sync-2026-07-19.md`](../apps/extension-spectra/docs/development-sync-2026-07-19.md) / [`regression-recovery-2026-07-18.md`](../apps/extension-spectra/docs/regression-recovery-2026-07-18.md) | 日期、commit、验证快照 |

## 3. 统一工程原则

### EPR-001：单一事实源（SSOT）

- 每个领域必须有一个 authority：Contracts 管协议形状，Background coordinator 管控制提交，`ControlSnapshot` 管字段实际值，`AudioSessionSnapshot` 只管处理器生命周期，Manifest/Registry 管 HALO 插件元数据。
- UI、缓存、Badge、远程端和兼容层都是 projection、transport 或 adapter，不能自行发明第二份权威状态。
- 同一概念只保留一个字段语义。旧别名只能只读迁移，并必须有删除版本。

### EPR-002：Desired、Actual、ACK、Snapshot、UI 预测必须分层

```text
desired intent → native/runtime actual → acknowledged actual → authority snapshot → UI projection
```

- 请求值不是成功值。
- setter 返回、storage 写入、处理器接受请求都不是 ACK。
- 只有事件/getter/处理器实际读回，并通过 identity、generation、revision 校验，才能形成 ACK。
- Optimistic UI 只能存在于短暂发送窗口，收到 ACK 后确认，失败后回滚。

### EPR-003：每个 ACK 都必须绑定身份和代际

任何可写操作至少绑定 `tabId + documentId + origin + generation`；媒体操作还绑定 `frameId + mediaId + sourceRevision`；控制事务绑定 `revision + intentId`。旧文档、旧媒体源、旧 processor generation 的迟到结果必须丢弃，不能更新新页面。

### EPR-004：READY 是能力屏障

Runtime 只有完成身份绑定、注册消息处理、媒体发现、初始 actual 同步、配置恢复、首次策略应用和 WebAudio/Capture 最终 ACK 后，才能发布 `ready`。初始化期间只能发布 `initializing`、`degraded` 或 `failed`。Background 的 READY 缓存只是优化，健康探测、dispose、导航、热更新或 context invalidation 都必须使其失效。

### EPR-005：同一文档只能有一个可写 Runtime

Runtime 生命周期固定为 `ABSENT → LOADING → INITIALIZING → READY → DISPOSING → ABSENT`。热更新允许旧实例销毁，但不能让旧、新实例同时写 DOM、Snapshot 或处理器。每个 consumer 使用 token/lease，只有最后一个 token 释放资源。

### EPR-006：每个 `{document, media, field}` 只有一个 writer

标准媒体属性集中在唯一 `NativeMediaExecutor`；站点官方 API 只能作为 DOM 读回失败后的单次、 allowlisted adapter；CSS、Overlay、Chrome API、WebAudio 和 Capture 各自有明确 owner 与 disposer。禁止第二个 writer、隐式 echo、永驻 page bridge 和通用 MAIN monkey-patch。

### EPR-007：按能力 native-first，不按整页模式决策

策略顺序固定为：

```text
observe → exact DOM/Chrome native → one-shot official site API → reversible augmentation → structured unsupported
```

音量、静音、倍速、播放、seek、loop、PiP、fullscreen 等保持原生边界；Boost、EQ、Bass、Compressor、Mono、Pan、Delay 等没有等价原生能力时才申请处理器。用户界面展示结果，不要求用户选择 Native/WebAudio/Capture。

### EPR-008：Capture 是按需的最后处理路径

Capture 只服务明确的 full-output DSP 或确实无法由安全 WebAudio 覆盖的处理需求。状态读取、普通原生音量、静音、倍速、播放、PiP、fullscreen 和仅存在缓存成员都不能启动 Capture。候选处理器必须在关闭 gate 下创建、读回实际配置后再切换；失败时恢复上一个稳定路径。

### EPR-009：每个网站只映射一个路径

媒体能力缓存的最小模型是：

```ts
{ domain, fingerprint: `site:${string}`, route: 'direct' | 'capture', source: 'user' | 'auto', updatedAt }
```

- 一个规范化网站只能有一个 route，不维护“安全列表”和“劫持列表”两份能力结构。
- `site:*` 是唯一持久化身份；`media:v1:*` 仅用于旧版本兼容读取，并在迁移时按域名折叠。
- 自动观察更新已有网站路径，不能覆盖用户固定路径；当前明确 ACK 可以纠正自动缓存。
- 缓存选择路径，不代表路径已激活；颜色和 UI 只能读取当前实际 ACK。
- 视频实例、`currentSrc` 变化和页面媒体数量只属于当前文档内存状态，永远不增加持久化列表行。

### EPR-010：不可逆操作先证明准入

`createMediaElementSource()`、Capture、外部网络、权限和 user activation 都可能跨过不可逆或受平台约束的边界。必须先收集同一元素/来源的完整证据，再绑定资源。CORS、DRM、受保护媒体、闭合 Shadow DOM、权限拒绝和过期 activation 是终止错误，不是继续猜测或扩大范围的理由。

### EPR-011：观察是纯投影，观察提交必须显式

纯 status/read 不能安装 listener、扫描文档、改变 active target、写设置、增加 revision、申请 Runtime/MAIN/offscreen 或生成合成事件。若页面真实事件要成为 authority，必须显式执行 `read → compare → revision + 1 → persist → publish` 的 observation commit。

### EPR-012：控制事务串行，但字段失败互不吞没

Background 是所有页面、Popup、热键和远程操作的唯一串行入口。事务读取 authority、校验 identity/revision、拆分 execution units、校验每个 ACK、执行补偿、提交 changed fields、持久化并广播。除非契约明确原子性，倍速失败不能吞掉 EQ，PiP 失败不能阻止音量，单个字段失败必须有自己的 rollback 和结构化错误。

### EPR-013：选择、恢复、观察三种语义分离

- `MediaRegistry` 记录候选事实，`SelectionEngine` 根据明确证据选择目标。
- 用户交互、真实页面控制、PiP/fullscreen owner、播放和稳定可见性才是选择证据。
- restore replay、扩展自写事件、marker seek 和非活动媒体加载不能抢占 active target。
- `activeMedia` 与 `activeVideo` 独立；音频元素不能清除视频目标，视频操作也不能偷换音频目标。

### EPR-014：页面事件必须先归因再选目标

事件先分类为页面交互、扩展写入、扩展恢复、扩展 seek、浏览器生命周期或未知来源，再应用 selection policy。扩展产生的 `volumechange`、`ratechange`、`seeked` 不能伪装成用户选择。页面真实观察只能提交一次 actual，不得回写第二次 DOM。

### EPR-015：原生 API 的生命周期边界不能被模拟绕过

PiP 和 fullscreen 只走标准 API、真实 user activation、生命周期事件和 getter。PiP 的“恢复”必须针对真实 `activeVideo`/`pictureInPictureElement`，不能依赖网站页面猜测、第二次提示、通用 MAIN 或 Capture。全屏切换不能通过改变页面音量制造激活；处理器 handoff 必须保存并恢复页面拥有的 baseline。

### EPR-016：快捷键与反馈是显式生命周期

- 新文档第一次快捷键必须先完成 identity-bound Runtime ensure，不能要求用户先打开 Popup。
- 快捷键 target 必须可设置、取消和校验 tab/document；焦点标签页信息只作为明确的反馈上下文。
- 长按只在按下、重复、松开三个边界内产生动作；松开后取消 pending repeat、toast 惯性和 timer。
- Toast 只能由明确的快捷键/操作 intent 触发；页面刷新、Runtime 初始化、普通 Popup 打开和状态同步不能自动弹出。
- 特殊 target toast 使用标准 Toast 视觉系统，只增加焦点标签页信息；音量条、消失时间和反馈 owner 必须与普通 Toast 一致。
- 每个 hotkey 只有一个 feedback owner，避免 OSD、语义 handler 和通用 listener 重复反馈。

### EPR-017：UI 文本、Tooltip、图标和状态必须有契约

- 所有按钮、Tooltip、状态变化和无障碍名称使用 canonical i18n key；缺 key 只能走可观测英文 fallback，不能渲染 `undefined`。
- 顶部按钮、选项卡按钮、reset/restore 按钮和动态状态都要纳入 locale completeness 测试。
- Reset 的产品语义必须明确：`100%` 和 `1x` 是真实控制值；恢复网页原始值是单独的 restore-page-settings 操作，不能混为“释放控制”。
- Favicon 使用浏览器支持的 favicon 服务/URL 生成规则，不声明未知 `_favicon` 权限，也不把获取图标失败转成未捕获 Promise。

### EPR-018：动态频谱只消费现有处理器

频谱订阅只能建立在已经 ACK 为 active 的处理器上。每个 Popup 是独立 generation-aware lease，最多一个 in-flight batch，采样上限 15 Hz；隐藏、不可见、关闭或异常退出立即释放 lease。没有 active processor 时不得创建 AudioContext、analyser、Capture 或隐藏 IPC。

### EPR-019：热更新、SPA 导航和 service-worker 重启必须可恢复

同文档导航由 `webNavigation` 事件和 Content 去重推进 generation；完整导航、扩展更新、worker suspend/restart、pagehide 和 tab close 都要使旧 identity/ACK/lease 失效。Offscreen 的 audio/remote lease 由 Background 唯一管理，HELLO 能恢复实际会话，不依赖悬挂 timer 或失效缓存。

### EPR-020：错误必须结构化、可观察、可归因

错误至少包含 `code + message + retryable + phase`，关键链路附带 `transactionId/requestId/tabId/documentId/generation/revision/runtimeRevision/mediaId/sourceRevision`。retryable 只描述当前策略是否能重试，不能授权越过 activation、permission、CORS、DRM 或 stale identity 边界。禁止空 catch、吞掉 Promise、统一成无上下文的 `timeout` 或 `control_failed`。

### EPR-021：消息、URL、QR 和外部边界先校验再执行

每个 `runtime.onMessage` listener 只拥有精确 request-type 集合，未知消息先返回 `false`。请求、响应、sender、tab/document、HTTP(S) URL 和 QR image URL 在边界校验；无 controllable origin、无权限、无有效 URL 都产生结构化错误。远程二维码使用本地可验证 SVG/data URL，不能把 pairing secret 放入可公开元数据或依赖未声明的网络生成器。

### EPR-022：远程控制默认关闭，认证后最小披露

远程会话使用独立随机 session/peer/secret/capability，URL fragment 立即转入 tab-scoped `sessionStorage`，HMAC challenge 成功前不发送状态、不接受命令。命令绑定 session、tab、generation、sequence 且拒绝重放、第二控制器和未认证数据。只传用户选择标签页的标题、域名和媒体控制状态，不传 favicon、页面内容、音频或视频。

### EPR-023：隐私承诺必须匹配物理流量

“本地优先/零遥测”不等于“绝不发生网络流量”。可选远程会使用静态远程站点、PeerJS signaling、STUN/TURN，并可能暴露 IP/连接元数据；发布页、`PRIVACY.md`、权限理由、远程站点 CSP 和实际构建包必须一致。HALO 的可选云备份也必须保持显式 opt-in，并与本地默认路径隔离。

### EPR-024：性能优化不能替换正确性

允许懒加载、latest-value coalescing、批量采样、trailing storage write、空闲释放和共享纯依赖；禁止用默认值代替实际读取、用缓存代替 identity、为快速 READY 跳过初始化、为少写 storage 伪造 Snapshot、用轮询掩盖缺失事件。每次优化同时记录可测指标：首次可交互、Runtime ensure、首个 ACK、IPC 次数、storage write、空闲资源数和重启恢复耗时。

### EPR-025：代码和模块保持高内聚、单向依赖

- Contracts 只描述形状和 guards，不下沉业务逻辑；Kernel 统一 RPC/storage；Audio-engine 负责 WebAudio 图；应用通过 facade 访问共享模块。
- 不跨域深层 import，不循环依赖，不用第二套私有 wire shape。
- HALO 工具按 `manifest/index/types/core/panel` 原子化；system、tool、script 物理隔离；内置 Settings 不污染 Registry。
- 目录和文件大小是可维护性信号，拆分以职责边界为准，不能为了行数制造碎片。

### EPR-026：测试必须覆盖时序和真实浏览器语义

单元测试验证纯函数和边界；契约测试验证协议/i18n/权限；状态机测试覆盖随机导航、媒体插入、source 替换、Popup、快捷键、processor handoff、dispose、重启和更新；Chrome smoke 必须覆盖真实 `event.isTrusted`、PiP activation、fullscreen、MutationObserver、source replacement、hidden tab、worker restart 和 ZIP 产物。类型检查或测试变绿不能单独证明架构完成。

### EPR-027：每个提交形成一个可回滚闭环

一个 commit 至少同时包含契约、实现、测试和文档中的必要闭环；改动前先定位 owner、调用方、runtime domain 和失败处理者，改动后运行局部测试、完整测试、真实 Chrome、architecture gate 和 diff 检查。历史报告必须标记日期、基线、验证范围和剩余风险，不得把旧数字当作当前状态。

### EPR-028：对外文案不得超过已证明能力

“所有网站”“零 CPU”“任何受保护媒体稳定工作”“完全不传输数据”等绝对句式只有在浏览器能力和发布门真正证明时才能出现。原生失败、权限、activation、CORS、DRM、闭合 Shadow DOM 和不支持站点必须允许结构化 unsupported；营销文案不能把内部 Capture 或站点 adapter 扩大成普遍保证。

## 4. 之前问题的原则化映射

| 历史现象 | 应用原则 | 长期判定标准 |
| --- | --- | --- |
| 音量/速度/静音全部失效 | EPR-002、EPR-006、EPR-012 | 由唯一 writer 执行，事件/getter ACK 后才更新 Snapshot |
| reset 失效 | EPR-017 | `100%`/`1x` 是字面控制值，restore 是另一种显式操作 |
| Toast 刷新网页时出现 | EPR-016 | 只有明确 intent 触发，初始化/刷新/同步不产生 Toast |
| 长按快捷键松手后仍有惯性 | EPR-016 | keyup 取消 repeat、timer、toast 和 pending action |
| 新网页必须先打开 Popup 才能用快捷键 | EPR-004、EPR-016 | 首次快捷键自动完成 identity-bound Runtime ensure |
| 动态频谱不显示 | EPR-018 | active processor + visible subscriber lease + bounded batch |
| 劫持网站全屏失败 | EPR-007、EPR-015 | 标准 fullscreen + trusted activation + baseline handoff |
| 网站 PiP 后无法恢复原视频 | EPR-013、EPR-015 | `activeVideo`、PiP owner、native enter/leave/getter 同一事务 |
| 抖音倍速 UI 不同步 | EPR-007、EPR-002、EPR-028 | 只允许已声明的 one-shot official adapter，成功须有官方 getter/readback |
| `_favicon` unknown、图标获取失败 | EPR-017、EPR-021 | 使用支持的 favicon URL/service，未知权限在构建/契约阶段拦截 |
| current document has no controllable origin | EPR-010、EPR-020 | 作为 terminal structured error，不能假装成功或无限重试 |
| READY handshake timeout | EPR-004、EPR-005、EPR-019 | 失效 cache、status probe、按 identity 重新注入；不产生 unhandled rejection |
| QR image URL invalid | EPR-021、EPR-022 | 生成前验证完整 URL/协议/fragment，渲染失败可观察且不泄露 secret |
| 安全/劫持列表冲突 | EPR-001、EPR-009 | 一个网站一个 route；视频实例不是第二种能力列表 |

## 5. 运行时检查清单

### 改代码前

- 明确文件属于 authority、projection、transport、executor、adapter、storage 还是 test。
- 写出它拥有的 identity、revision、generation、lease 和失败处理者。
- 用 GitNexus 查询调用链和上游影响；共享 symbol 先做 impact。
- 找到唯一 owner 文档和现有静态检查，不在第二个文档复制规则。

### 改代码后

- 更新 contracts、实现、测试和 owner 文档。
- 验证无第二 writer、无无身份 Runtime、无跨域 stale ACK、无默认值伪 actual。
- 运行定向单元/契约、全量单元、typecheck、lint、build、Chrome dev smoke、production ZIP smoke、architecture gate 和 `git diff --check`。
- 用 `detect_changes(scope="all")` 审计实际影响范围。

### 发布前

- 检查 PR/branch 是否包含完整闭环，历史报告数字是否明确标注时间。
- 检查 manifest 权限、隐私政策、store listing、remote-site 字节/CSP/MIME 与实际产物一致。
- 检查默认页面没有 AudioContext、Capture、analyser、offscreen 或周期性 IPC。
- 检查所有远端状态都由 ACK/Snapshot 驱动，未认证远程端没有状态和命令通道。

## 6. 全部 Markdown 文档索引

### 仓库治理与入口

- [`/AGENTS.md`](../../AGENTS.md)：GitNexus、修改前影响分析、提交前变更审计。
- [`/CLAUDE.md`](../../CLAUDE.md)：与 `AGENTS.md` 重复的 GitNexus 工作流入口；两者应保持一致。
- [`/rules.md`](../../rules.md)：安全、依赖、模块边界、测试、性能、文档和 Git 规则。
- [`/README.md`](../../README.md)：根目录代理入口和工作目录边界。
- [`/spectra.md`](../../spectra.md)：SPECTRA 恢复与闭环实施规范；适合作为问题分析/测试时序手册，不替代当前控制架构 owner。

### NEXUS 工作区与产品治理

- [`README.md`](../README.md)：monorepo 项目入口。
- [`README.AI.md`](../README.AI.md)：模块 DNA、开发导读、红线和验证命令；部分数字/发布命令需要定期更新。
- [`plan.md`](../plan.md)：NEXUS 产品路线。
- [`docs/ai-rules.md`](ai-rules.md)：指向根 `rules.md` 的短入口。
- [`docs/business-model.md`](business-model.md)：商业模式与本地隐私定位。
- [`docs/halo-dev-flow.md`](halo-dev-flow.md)：HALO 工具目录、SidePanel 和命名规范。

### SPECTRA 规范、证据与产品资料

- [`apps/extension-spectra/docs/control-architecture.md`](../apps/extension-spectra/docs/control-architecture.md)：唯一控制架构 owner，含能力矩阵、静态不变量和落地账本。
- [`apps/extension-spectra/docs/architecture.md`](../apps/extension-spectra/docs/architecture.md)：Runtime context 所有权和加载拓扑。
- [`apps/extension-spectra/docs/protocols.md`](../apps/extension-spectra/docs/protocols.md)：跨上下文 state/message/lease 协议。
- [`apps/extension-spectra/docs/remote-security.md`](../apps/extension-spectra/docs/remote-security.md)：远程配对、HMAC、命令绑定和 offscreen 集成。
- [`apps/extension-spectra/docs/cors-data-flow.md`](../apps/extension-spectra/docs/cors-data-flow.md)：不可逆 WebAudio 绑定前的来源准入。
- [`apps/extension-spectra/docs/bidirectional-sync-principles.md`](../apps/extension-spectra/docs/bidirectional-sync-principles.md)：双向同步入口，规则归属控制架构。
- [`apps/extension-spectra/docs/policy-decision.md`](../apps/extension-spectra/docs/policy-decision.md)：策略入口，规则归属控制架构。
- [`apps/extension-spectra/docs/regression-recovery-2026-07-18.md`](../apps/extension-spectra/docs/regression-recovery-2026-07-18.md)：2026-07-18 回归基线和待恢复矩阵，历史证据。
- [`apps/extension-spectra/docs/development-sync-2026-07-19.md`](../apps/extension-spectra/docs/development-sync-2026-07-19.md)：当前主分支相对旧基线的实现同步与验证证据。
- [`apps/extension-spectra/docs/optimization-review-2026-07-15.md`](../apps/extension-spectra/docs/optimization-review-2026-07-15.md)：v1.3.4 历史发布证据。
- [`apps/extension-spectra/docs/optimization-review-2026-07-17.md`](../apps/extension-spectra/docs/optimization-review-2026-07-17.md)：native-first 历史发布证据，当前规范仍回链 control architecture。
- [`apps/extension-spectra/plan.md`](../apps/extension-spectra/plan.md)：SPECTRA 产品路线和历史修复记录。
- [`apps/extension-spectra/README.md`](../apps/extension-spectra/README.md)：功能、安装、技术栈和对外简介。
- [`apps/extension-spectra/PRIVACY.md`](../apps/extension-spectra/PRIVACY.md)：本地数据、可选远程和第三方网络披露。

商店文案同构但语言不同，均纳入本次检查：

- [`apps/extension-spectra/store-listings/en-US.md`](../apps/extension-spectra/store-listings/en-US.md)
- [`apps/extension-spectra/store-listings/zh-CN.md`](../apps/extension-spectra/store-listings/zh-CN.md)
- [`apps/extension-spectra/store-listings/zh-TW.md`](../apps/extension-spectra/store-listings/zh-TW.md)
- [`apps/extension-spectra/store-listings/de-DE.md`](../apps/extension-spectra/store-listings/de-DE.md)
- [`apps/extension-spectra/store-listings/es-ES.md`](../apps/extension-spectra/store-listings/es-ES.md)
- [`apps/extension-spectra/store-listings/fr-FR.md`](../apps/extension-spectra/store-listings/fr-FR.md)
- [`apps/extension-spectra/store-listings/ja-JP.md`](../apps/extension-spectra/store-listings/ja-JP.md)
- [`apps/extension-spectra/store-listings/ko-KR.md`](../apps/extension-spectra/store-listings/ko-KR.md)
- [`apps/extension-spectra/store-listings/ru-RU.md`](../apps/extension-spectra/store-listings/ru-RU.md)
- [`apps/extension-spectra/store-listings/privacy-justifications.md`](../apps/extension-spectra/store-listings/privacy-justifications.md)：权限和 Dashboard 申报唯一参考。

### HALO 架构、规划与研究

- [`apps/extension-halo/docs/architecture.md`](../apps/extension-halo/docs/architecture.md)：SidePanel、插件类型、Registry、i18n 和动画系统。
- [`apps/extension-halo/plan.md`](../apps/extension-halo/plan.md)：工具路线、SSOT/Atomic/Isolation/Local First 原则和待解决问题。
- [`apps/extension-halo/docs/research.md`](../apps/extension-halo/docs/research.md)：市场定位、竞品痛点和技术方向。
- [`apps/extension-halo/docs/feature-gap-analysis.md`](../apps/extension-halo/docs/feature-gap-analysis.md)：工具功能差距和优先级。
- [`apps/extension-halo/docs/plan-hover-zoom-v2.md`](../apps/extension-halo/docs/plan-hover-zoom-v2.md)：Hover Zoom 模块化、懒加载、MSE 和后续路线。
- [`apps/extension-halo/docs/plan-danmaku.md`](../apps/extension-halo/docs/plan-danmaku.md)：弹幕 Protobuf/Canvas/时间轴设计和验收标准。

### HALO 市场研究

- [`docs/market-research-summary.md`](market-research-summary.md)：整体竞品痛点与 HALO 差异化。
- [`docs/market-research-dark-reader.md`](market-research-dark-reader.md)：性能、兼容性和早注入策略。
- [`docs/market-research-lightshot.md`](market-research-lightshot.md)：截图隐私、完全本地处理和 OCR。
- [`docs/market-research-onetab.md`](market-research-onetab.md)：标签丢失、双备份和同步。
- [`docs/market-research-halo-extra.md`](market-research-halo-extra.md)：QR、滚动、剪贴板、限时功能的本地优先策略。

### 独立远程站点

- [`remote-site/README.md`](../../remote-site/README.md)：静态部署、Pinned PeerJS、fragment pairing、CSP/字节/MIME 发布门。

## 7. 已发现的文档漂移与处理规则

1. `regression-recovery-2026-07-18.md` 的基线、当前 commit、测试数量和“待实施”状态是历史快照；修复完成后不覆盖历史数字，应新增当前验证报告或更新“已验证于”字段。
2. 两份 `optimization-review` 已声明为历史证据，当前实现以 `control-architecture.md`、`architecture.md` 和 `protocols.md` 为准。
3. `README.AI.md` 中的工具数量、旧版命令和公开仓库强制推送说明需要在下次发布前重新核对；不得将 `push -f` 当作默认工作流。
4. SPECTRA 商店文案中的“所有网站”“零 CPU”“受保护媒体稳定工作”等绝对表述超过当前结构化 unsupported 和浏览器安全边界；发布前必须改成能力范围与失败语义可证明的表述。
5. 商业模式的“零上传”必须表述为产品不运营数据收集服务；SPECTRA 可选远程的标题/域名/控制状态和第三方连接元数据必须继续按 `PRIVACY.md` 披露。
6. HALO 研究中的 Google Drive/跨设备备份属于可选外部能力，必须保留本地默认路径、最小权限和显式 opt-in，不能与“零网络请求”核心定位混为默认行为。
7. 根 `rules.md` 要求的文档压缩格式与现有架构文档的大量表格存在表达层冲突；格式偏好不能压过架构可读性，表格只保留在能降低歧义的矩阵/映射场景。
8. `AGENTS.md` 与 `CLAUDE.md` 内容重复，后续只保留一个维护源或增加一致性检查，避免工具规则分叉。
9. GitNexus 当前索引提示落后主分支提交，且 clusters 为空；本次文档结论以直接 Markdown/source 读取为主，重新索引后再补一次图谱审计。

## 8. 文档维护 SOP

1. 新增规则先判断它是规范、证据、规划、产品文案还是隐私政策；规范必须指定唯一 owner。
2. 代码变更先更新 Contracts/owner 规则和失败测试，再更新实现；禁止先改多个 projection 追赶一个未定义的 authority。
3. 每次发布同时检查内部文档、README、PRIVACY、store listings、remote-site 和构建产物的事实一致性。
4. 历史报告追加日期和验证范围，不回写旧 commit 的结果；当前状态另建带日期报告。
5. 自动化检查至少包括内部链接、文档索引覆盖、locale 结构、权限/隐私关键字、过期测试数字和“所有网站/零 CPU/绝不传输”等绝对承诺扫描。
6. 代码提交前执行 GitNexus impact/detect_changes、完整测试、Chrome smoke、生产产物检查和 `git diff --check`。

这份文档是统一索引和原则层，不替代 SPECTRA 的能力矩阵、协议定义、隐私政策或 HALO 的具体工具设计；它只规定这些文档如何分工、如何互相约束，以及历史问题如何转化为可验证不变量。
