---
type: explanation
status: draft
audience: developer
owner: spectra-unified-design
last_reviewed: 2026-10-28
---

# SPECTRA 统一设计方案（终稿）

本方案把 SPECTRA 的视觉规范、组件结构、交互模式、命名与目录约定、代码风格收敛为一份
自洽的整体设计。**它不创造第二套规范**：每一条规则都标注其现有 owner，
owner 已有定义的，本文只做整合与索引；owner 之间存在冲突的，本文给出唯一消解口径。

## 0. 权威边界与「终稿」的含义

按 [NEXUS documentation](../../../../docs/README.md) 的权威层级，本文是 **proposal，不是行为权威**。
行为权威依序为：可执行契约与测试 → [control/ 主题 owner](../control/README.md) →
[runtime architecture](../architecture/runtime.md) → [protocols](../reference/protocols.md)。
本文与它们冲突时，以它们为准，并修订本文。

「终稿」在此处的准确含义是：

1. **无重复**——同一规则只有一个 owner，本文不复制其条款，只给链接。
2. **无冲突**——已识别出的矛盾被显式消解（见 §10.2）。
3. **有落点**——每条规则都能追到契约、测试、门禁或 owner 文档之一。
4. **可失效**——§12 写明什么情况必须重审本方案。

它不是「完美架构」的宣称。已知的未完成项在 §12，不隐藏。

## 1. 设计总纲

> **一个 authority，一次 ACK，一个写者，一条 Native-first 路径，证明不可删除。**

| 不可协商项 | 含义 | 现有 owner |
|---|---|---|
| 单一事实源 | 每个领域只有一个 authority；UI / badge / 缓存 / 远程端都是 projection | EPR-001 |
| ACK 分层 | `desired → actual → acknowledged → snapshot → projection`；setter 返回不是 ACK | EPR-002 / 003 |
| 唯一写者 | 每个 `{document, media, field}` 与每个投影元素只有一个写者 | EPR-006 / 006a |
| Native-first | `observe → exact DOM/Chrome native → one-shot 官方 API → 可逆增强 → structured unsupported` | EPR-007 / 008 |
| 证明不删除 | 等待可以移出关键路径，但证明本身必须作为可观测信号保留 | EPR-002a |

派生推论：UI 永不让用户选择 native internals、MAIN bridge 或 Capture；
`100%` 与 `1x` 是字面值，不是「释放控制」（[01 §1](../control/01-foundations.md)）。

## 2. 分层与目录：结构即架构

依赖方向只允许向下，同层投影面之间不得互相 import（`LAYER-001`）。

| 层 | 职责 | 真实位置 | 允许依赖 |
|---|---|---|---|
| L1 契约 | 协议、快照、纯值对象、零 `@nexus` 依赖 | `packages/contracts/src/` | 无 |
| L2 内核 | 通用有界容器、时钟、调度 | `packages/nexus-kernel/` | L1 |
| L3 领域 | 音频引擎、算法矩阵 | `packages/features/audio-engine/` | L1–L2 |
| L4 运行时 | 路由、事务、执行器、offscreen host | `src/background/`、`src/content/`、`src/offscreen/` | L1–L3 |
| L5 投影 | card、side-panel、OSD、badge、options、remote page | `src/popup/`、`src/options/`、`src/content/ui/`、`src/remote/` | L1 + 自身 |

配套规则：

- `sideEffects: false` 在 `@nexus/contracts`、`audio-engine`、`kernel` 启用，保证 tree-shaking。
- Manifest 只注入 `content-bootstrap.js`；完整 `content-runtime.js` 经 READY 事务惰性加载。
- 生产构建只有一次 esbuild 压缩/混淆 pass，禁止二次 Terser（[03 §7.2](../control/03-ui-and-boundaries.md)、SCTRL-044）。
- 目录按 **runtime context** 划分，不按技术类型划分；`shared/` 只放跨 context 的纯函数与常量。

## 3. 运行时拓扑与状态模型

### 3.1 六个上下文

| 上下文 | 拥有 | 明确不拥有 |
|---|---|---|
| Popup / Options | intent、本地渲染、交互 | actual audio mode、直接存储、执行器选择 |
| Content（isolated） | 文档身份、媒体注册表、DOM/CSS writer、WebAudio graph | Capture 构造、读回前的 active 声明、跨 tab 热键选目标 |
| MAIN bridge | 全屏音频交接、精确元素 page-media 读写 | 通用 dispatch、域表、跨 tab 状态 |
| Background worker | 路由、设置、快照、badge、runtime lease | WebAudio 节点、乐观 UI |
| Offscreen host | Capture 处理器、认证 remote session | 直接文档创建/关闭 |
| Remote page | 认证后的意图提交 | 任何 actual 状态 |

每条箭头都是**经过校验的端口**，不是共享可变状态。只有物理 owner 能产出 actual 事实，
只有 Background 能把事实提交进持久控制模型（[runtime.md](../architecture/runtime.md)）。

### 3.2 状态机的数量由身份轴决定

五台状态机，**不可合并**：`AudioSession`(tab+doc+origin)、`FieldTransaction`(tab+doc+field)、
`RemoteSession`(session+epoch)、`CaptureAdmission`(admission id)、`SiteEligibility`(域名)。
八个有界过程（loader、coordinator、手势回放、手势合流、AB 调度、visualizer 订阅、
媒体探测池、popup 控制端口）不是状态机，共同形态是**单飞 + 引用计数 + 单调水印 + TTL**。

### 3.3 快照分工

| 快照 | 拥有 | 不得做 |
|---|---|---|
| `ControlSnapshot` | 已 ACK 的 `volumeBase + boost`、mute、speed、transport、DSP、video 字段 | 不携带处理器生命周期 |
| `AudioSessionSnapshot` | `desiredMode / actualMode / phase / generation / error` | 永不覆盖控制字段 |
| tab-session record | 20 个可刷新恢复字段的持久化投影 | 只存 actual，不存默认值 |

有效音量是**完整 ACK 对**（`volumeBase + boost`）的投影，不是一个独立字段；
`volume`、`volumeBase`、`boost` 构成同一个 canonical 值对象，任何局部 patch 先合并再规范化。

## 4. 控制事务：从 intent 到像素

### 4.1 标准链路

```text
intent（Popup / hotkey / remote / page）
  → Background coordinator（每 tab 单 actor，串行）
  → 物理 owner（Content / offscreen）写入 + 读回
  → identity / generation / revision 复核
  → 提交 ControlSnapshot（持久化先确认，再广播）
  → 有界投影（card / side-panel / OSD / badge）
```

### 4.2 写入与确认分离（native 字段专用）

| `writeState` | 含义 | 事务可否作答 |
|---|---|---|
| `written` | setter 已执行，元素当前反映请求值 | 可以 |
| `confirmed` | 静默窗 + 两个渲染边界后仍成立 | 可以 |
| `drifted` | 页面在我们写入后改回了别的值 | 回写 observed actual，计入站点 ledger |
| `unconfirmed` | 稳定化未结束（中止 / DRM 无事件 / 超时） | **不是失败**：不报错、不补偿 |

约束：证明在作答之后以可取消后台任务运行；写入仍串行，被降级的是等待，不是顺序；
同站点 drift 累计到阈值即降级为「先证明后作答」。
**不适用**：Capture/WebAudio 增益、处理器生命周期、跨 100 路由边界——这些仍然事务化。
（owner：EPR-002a、SCTRL-045..048、[05 §11.1](../control/05-control-state.md)）

### 4.3 顺序与代际

- 可写操作绑定 `tabId + documentId + origin + generation`；媒体操作追加 `frameId + mediaId + sourceRevision`。
- 控制事务绑定 `revision + intentId`；旧代际的迟到结果直接丢弃。
- `generation` **只排序，不授权**——不得据其豁免证据校验。
- 同代 `active → stopping` 被拒绝：停止必须换 generation（oracle：`audio-session-phase.transitions.spec.ts`）。

### 4.4 失败

结构化错误码分为「能力缺口」（释放并尝试下一策略）与「浏览器/安全边界」（终止，保持稳定路径）。
任何控制写入失败必须：清除待发送值 → 回滚到最后一次 ACK → 强制重读权威快照 →
投影为可访问的 Toast，不得呈现为成功（[03 §19](../control/03-ui-and-boundaries.md)）。

## 5. 视觉设计体系

### 5.1 双层 token 模型（本方案最重要的视觉约定）

| 层 | 载体 | owner | 适用面 |
|---|---|---|---|
| 文档内 token | CSS 自定义属性，随主题变化 | `public/popup.css`、`public/options.css` | popup、side-panel、options |
| 文档外字面量 | `UI_COLORS` 常量 | `src/shared/ui-colors.ts` | content shadow root、OSD、canvas、SVG data URL、QR |

文档外的面**无法读取扩展 CSS**，所以必须有字面量；文档内的面**必须读 live token**，
否则暗色主题下会画出错的颜色。桥接点是 `popupPrimaryColor()`：
按主题缓存一次 `--primary`，而不是每帧读 `getComputedStyle`。

### 5.1.1 已知分歧：Options 仍是第二套 token（未统一）

`public/options.css` 维护的是**独立命名的第三套值**，与 `popup.css` 不是同一体系：

| 语义 | popup.css | options.css | 是否一致 |
|---|---|---|---|
| 主色 | `--primary: #2563eb`（亮色优先） | `--accent: #6366f1`（暗色优先） | **否，色相不同** |
| 画布底色 | `--bg: #f1f5f9` / 暗色 `#0f172a` | `--bg-primary: #0f0f0f` / 亮色 `#f5f5f5` | **否，中性色温不同** |
| 文本 | `--text` | `--text-primary` | 命名不同，值接近 |
| 圆角 | `--radius: 14px` | `--radius-sm/md/lg: 4/8/12px` | **否，尺度不同** |
| 字体 | `"Inter", system-ui` | `"Inter", -apple-system…` | 实际渲染一致 |

**本轮不统一，理由**：统一意味着 Options 的按钮色、画布底色、圆角尺度全部改变，
属于**产品视觉决策**，无法用测试证明「更好」，也不该在没有视觉评审的情况下悄悄改像素。
机械事实是：TS 侧已零硬编码（`ui-colors.ts` 之外没有任何颜色字面量），
CSS 侧所有颜色都在 token 块内——**分歧在 token 的取值，不在绕过 token**。

要把它们合并成一套，正确顺序是：先确定唯一的品牌主色与中性色阶，
再抽 `tokens.css` 供两个页面共同引用，最后由视觉基线截图确认。
在此之前，本方案不宣称「Options 与 Popup 视觉一致」。

### 5.2 颜色语义：颜色是已确认用户结果的函数

| 语义 | light | dark | 规则 |
|---|---|---|---|
| 非 Capture 已 ACK（native 或 MediaElement WebAudio） | `#2563eb` | `#60a5fa` | **不是**处理器类型 |
| Capture active ACK | `#7c3aed` | `#7c3aed` | 仅 `actualMode:'capture'` + `phase:'active'` |
| 静音 / 0 | `#9ca3af` | `#9ca3af` | 与路由无关 |
| 成功（倍速 OSD） | `#10b981` | `#34d399` | — |
| 危险 | `#ef4444` | `#f87171` | — |
| 禁用 | `#94a3b8` | — | — |

> **禁止给颜色加第二层含义。** 颜色不表达拓扑、不表达处理器类型、不表达「未结算」。
> 未结算用**数值与色调的分离**表达（§7.2），不用新颜色。任何让 purple 出现在
> 非 active ACK 之下的改动都是缺陷。

### 5.3 布局与尺寸

- Popup 主列 **390px**；side panel 展开 **650px**；Settings 导航模式才有 **600px** 滚动视口。
- **CSS 是唯一尺寸 owner**：导航只切换模式类，禁止读 `offsetHeight` 后写 inline `min-height`，禁止 `resizeTo`。
- 卡片圆角 `14px`，阴影 `0 4px 20px -4px rgba(0,0,0,0.06)`（dark 为 `0.3`）。
- 字体 `"Inter", system-ui, sans-serif`；滚动条 6px，颜色由 `--text` 派生。
- Toast / OSD 在全屏下挂载到 Popover top-layer，避免被覆盖。

### 5.4 动效与帧预算

- 过渡只有三档：**0.15s / 0.2s / 0.3s**；入场 `fadeIn 0.2s ease`，加载 `spin 1s linear infinite`。
- 连续控制走 **rAF 合并**，指针直绘与帧合并渲染共用同一个 view writer。
- 帧下限 **16.7ms @60Hz** 是物理约束，不是优化目标；任何「零延迟」宣称都是错的。
- `prefers-reduced-motion` 由 `public/accessibility.css` 统一强制，产品 CSS 不得恢复动效。
- 视觉化采样上限 **15 Hz**，且必须等到 `actualMode: webaudio|capture` + `phase: active` 的精确 ACK。

### 5.5 可访问性

- focus ring 由 `--spectra-focus-ring` 统一提供（light `#2563eb` / dark `#60a5fa`），2px outline + 2px offset。
- 弱化文本用 `--text-muted`，不得借 UA 的 opacity 乘数降低对比度。
- 不得强制横向滚动；键盘可达性优先于视觉取舍。
- 结构化失败必须投影为**可访问**错误 Toast；Options 用行内可访问错误。

### 5.6 文案与 i18n

九种 locale 共享同一语义契约；所有 UI 文本、tooltip、状态、Reset 行为走 canonical locale key，
缺失走**可观测的英文 fallback**。不允许在代码里写面向用户的硬编码字符串。

## 6. 组件结构与写者矩阵

### 6.1 投影面清单

| 投影面 | 位置 | 数据源 | 不得做 |
|---|---|---|---|
| Popup 主卡 | `src/popup/card/` | `ControlSnapshot` + `AudioSessionSnapshot` | 不写 storage、不选执行器 |
| Side panel | `src/popup/side-panel/` | 同上，video 走 `activeVideo` | 不与 card 互 import |
| Content OSD | `src/content/ui/` | 已确认字段 + 当前请求值 | 不创建 Capture 节点 |
| Badge | `src/background/` | 使用事实 + 已确认路由 | 不自建第二权威状态 |
| Options | `src/options/` | 权威 settings snapshot | 不把 `DEFAULT_*` 伪装成已保存状态 |
| Remote page | `src/remote/` | 认证后的投影 | 不持有 actual |

### 6.2 卡片内部四件套

```text
state.ts    合并快照、维护 pending、决定冻结条件
render.ts   帧合并渲染，只读 state，只写 view
events.ts   指针事件 → intent + 指针直绘（仍经由 view）
view 层     唯一的 DOM 写者（volume-view.ts 是音量范式）
```

**关键约束**：`render.ts` 与 `events.ts` 都不得直接写投影元素的 DOM/CSS，
必须经过对应 view 模块。两个写者时后写者静默获胜，表现为填充条落后或一帧闪回。

### 6.3 单一写者矩阵

| 投影元素 | 唯一写者 | 门禁 |
|---|---|---|
| 卡片音量填充 / 读数 / 原生滑块 | `popup/card/volume-view.ts` | UI-004 |
| 控件值 | 权威快照投影，不得由 DOM 读回计算 | UI-004（G8） |
| 标准媒体属性 | `native-media-executor.ts` | EPR-006 |
| CSS / Overlay | 各自的 owner + disposer | EPR-006 |
| 投影面之间的依赖 | 禁止 | LAYER-001 |

## 7. 交互模式库

### 7.1 连续控制（拖动 / 滚轮 / 快捷键）

- 手柄位置、数字、填充条**立即跟随当前请求**，任何路由边界（含 100%）都不得冻结它们。
- 色调继续消费已确认生命周期；路由事务未结算时保留上一次已确认路由的色调。
- 快捷键按住与松键冻结阶段都保留最新同手势 actual ACK；最后 ACK 先于 keyup 到达也必须完成纠正。
- 新手势始终隔离旧手势结果；旧 ACK 不覆盖新目标。

### 7.2 数值与色调分离（本方案对 §7/§19 冲突的消解）

```text
数值 = f(当前请求)              // 永远实时，不需要 ACK
色调 = f(最后一次已确认路由)     // 需要 ACK
静音 = f(已确认 mute)           // 需要 ACK
```

「数字、填充条、颜色必须作为一个已确认结果提交」这一旧表述只在**颜色维度**成立；
把它扩展到数值会导致跨边界整段冻结（2026-10-28 事故）。消解细节见 §10.2。

### 7.3 其余模式（owner 已有定义，此处只索引）

| 模式 | 规则要点 |
|---|---|
| Preset | 清空与应用各一次原子 patch / 一个 revision；busy 期间等权威 ACK；确认预览用语义化 `<dl>` |
| Effects | 显式按钮进入，`Enter` 确认、`Escape` 返回并恢复触发焦点 |
| Reset / Restore | Reset 写字面 `volume=1`、`rate=1`；恢复网页原值是**另一个**操作 |
| Popup 关闭 | 关闭前最后用户意图必须已由存活的 Background owner 接收，不依赖正在销毁的 UI realm |
| Options 启动失败 | 统一错误面 + Retry；Retry 先释放本次 attempt 的 owner 再原地重跑，禁止 `location.reload()` |
| 视觉化 | 仅可见、启用、未静音的前台主卡可声明 demand；订阅不得创建或保留 Capture |
| Badge | 记录 per-tab 使用事实；完全无控制的空白页保持为空 |
| Remote | busy 时不可关闭或重复提交，失败后保留可重试状态 |
| 页面观察 | `volumechange` / `ratechange` 只提交一次，永不回显 DOM 写入；页面手势把非中性 Boost 复位为 1 |

## 8. 命名、目录与代码风格

### 8.1 文件与目录

- 文件名 **kebab-case**，按职责命名：`volume-view.ts`、`native-media-executor.ts`。
- 测试为 `test/<topic>.spec.ts`，与源码分目录；构建脚本在 `scripts/`。
- 文档编号即 owner 编号：`control/01..08`；`proposals/` 只放候选设计；`_archive/` 只放历史快照。

### 8.2 编号命名空间（不得混用）

| 前缀 | 域 | owner |
|---|---|---|
| `EPR-xxx` | 工程原则 | `docs/principles/` |
| `SCTRL-xxx` | SPECTRA 静态不变量 | [08](../control/08-invariants-and-gates.md)（当前 048） |
| `ALG-xxx` | 源码算法审计 | [04](../control/04-algorithm-matrix.md)（当前 050） |
| `UI-xxx` | 投影权威检查 | `check-ui-authority.ts` |
| `LAYER-xxx` | 分层依赖检查 | `check-architecture-layers.ts` |
| `G1..G8` | 可执行门禁 | `scripts/verify/` |
| `SP-xx` / `INV-xx` | 历史审计登记与不变量 | 仅研究文档，非当前权威 |

### 8.3 注释约定（仓库实际使用频次）

```ts
// goal: 这个模块解决什么问题（src/ 实测 239 处）
// inv:  必须始终成立的不变量（28 处）
// eff:  副作用是什么（126 处）
// post: 后置条件（46 处）
// note: 非显而易见的背景（54 处）
```

新代码至少写 `goal`，涉及状态或写者的必须写 `inv`。注释描述**机制**，不复述代码。

### 8.4 代码风格

- 缩进 **tab**（现存 19/20 采样文件；`popup/constants/colors.ts` 是 2 空格的历史例外，新代码不得沿用）。
- Biome 仅启用 `recommended` lint，**formatter 关闭**——风格靠评审与约定，不靠自动格式化。
- 命名导出优先；纯函数与副作用分离；纯值逻辑放 `*-values.ts` / `shared/`。
- 文档 frontmatter 必须有 `type / status / audience / owner / last_reviewed`，
  `stable` 的 owner 全仓唯一（`docs:check` 强制）。

### 8.5 测试约定

- `bun run test:unit` 走 `scripts/run-tests.ts`，**逐文件隔离**执行，禁止跨文件共享状态。
- 排序、代际、浏览器语义必须有独立 oracle（如 `sameGenerationOracle`），不得用实现反推期望。
- 涉及 DOM 投影的改动必须补**渲染层**测试；只测状态层会让「状态对了」被误当「显示对了」。

## 9. 验证体系

| 层 | 内容 | 执行入口 |
|---|---|---|
| 契约 | 51 capabilities、28 字段、23 操作 | `packages/contracts` + 契约测试 |
| 静态不变量 | `SCTRL-001..048` | `bun run verify` |
| 门禁 | G1–G8 | `scripts/verify/check-*.ts` |
| 分层与投影 | `LAYER-001`、`UI-004` | `check-architecture-layers.ts`、`check-ui-authority.ts` |
| 文档 | frontmatter、链接、owner 唯一、可达性 | `bun run docs:check` |
| 单元测试 | 逐文件隔离 | `bun run test:unit` |
| 浏览器取证 | 真实 Chrome 集成 | `bun run test:chrome` |
| 发布 | 供应链、隐私、产物 | `release-spectra.ts` |

规则：**行为变更必须同时落到契约、实现、测试、owner 文档、门禁**；缺一项即未闭环。

## 10. 与现有设计的衔接方式

### 10.1 每章的权威 owner

| 本文 | 权威 owner | 关系 |
|---|---|---|
| §1 总纲 | `docs/principles/01`（EPR-001..009、002a、006a） | 索引，未新增条款 |
| §2 分层 | `architecture-layers.json` + [03 §7.2](../control/03-ui-and-boundaries.md) | 整合为一张表 |
| §3 拓扑/状态 | [runtime.md](../architecture/runtime.md)、[01 §2](../control/01-foundations.md) | 索引 |
| §4 事务 | [05](../control/05-control-state.md)、EPR-002a、SCTRL-045..048 | 索引 |
| §5 视觉 | [03 §7/§19](../control/03-ui-and-boundaries.md)、`popup.css`、`ui-colors.ts`、`accessibility.css` | 首次把双层 token 写成显式约定 |
| §6 组件 | EPR-006a、UI-004、LAYER-001 | 首次给出写者矩阵 |
| §7 交互 | [03 §19](../control/03-ui-and-boundaries.md)、[05](../control/05-control-state.md) | 索引 + §7.2 的冲突消解 |
| §8 风格 | `biome.json`、源码注释统计、`lint-docs.ts` | 首次成文 |
| §9 验证 | `scripts/verify/`、`package.json` | 索引 |

### 10.2 已识别并消解的冲突

[03 §7](../control/03-ui-and-boundaries.md) 原文要求「音量数字、填充条和结果颜色必须作为一个
已确认结果提交，不能把新数字与旧处理器颜色拼接」；同文档 §19 又要求「连续数值控制在输入任务中
显示最新请求值，音量跨过 100% 不冻结数字、滑块或 OSD」。**路由切换时这两句不能同时成立。**

消解口径（与已落地实现一致）：**数值永远实时，色调等待 ACK**——
即「不拼接」约束保留在颜色维度，不再覆盖数值。owner 文档 §7 的对应句子已按此口径修订。

### 10.3 与 2026-10-26 设计 v4 的关系

v4 从未整体落地，本方案**不复活**它。采纳其仍然成立的部分：
五台状态机不可合并、八有界过程不建迁移表、DOM 单向写、generation 只排序不授权、
颜色不表达拓扑；四种共享形状中 `Verdict` / `Rejection` / `Bounded` 已落地
（`packages/contracts/src/fact.ts`、`bounded.ts`），后续新增准入判断应复用它们。
放弃：视觉层「三轴正交 + 8 token」（与颜色语义冲突，原作者已撤回）、
INV-7（与现行转移矩阵矛盾）；`Fact` 本体仍未实现，暂不引入。
完整证据见 [架构审计合并版](../../../../docs/research/2026-10-26-spectra-architecture-audit.md)。

### 10.4 与 V3 proposal 的关系

[Unified Control Runtime V3](unified-control-runtime-v3.md) 是 2026-08 修复候选的**历史**迁移设计，
其状态声明冻结于当时。本方案不取代其历史记录，只在其之上补齐 V3 未覆盖的两层：
**视觉 token 体系**与**写者矩阵**。

### 10.5 剩余工作的落地顺序

1. **度量闭环** — 已部分落地：诊断端口输出 intent → settled 的 p50/p95/max。
   仍缺 `runtime-performance-policy.json` 的 Chrome workload（需 20 样本 × 2 次独立运行）。
2. **冻结条件上提** — 已完成：`shouldHoldVolumeTone()` 归契约层，边界只引用
   `CONTROL_VALUE_LIMITS.volumeBase.max`。
3. **pre-push 补 `test:unit`** — 已完成（118 文件 / 11s）。同时修掉运行器无限等待：
   任一文件超时即杀并点名，门禁失败而不是挂死。
4. **修 `sync-spectra`** — 已修，但**提交后才生效**：sync 校验的是 `git show HEAD:` 内容，
   不是工作区；真因是无扩展名导入与 `.ts` allowlist 不匹配。
5. **badge 静音误显** — 未开始，仍需先做决策输入快照复现，不再提第三版猜测方案。

### 10.6 不做的事

不合并五台状态机；不给八个有界过程建迁移表；不消灭 DOM 承载态（只约束方向）；
不给颜色加第二层含义；不引入隐式 limiter；不让 UI 暴露 native/MAIN/Capture 选择；
不动 SPECTRA 与 HALO 的共享契约边界；不为「零延迟」做任何宣称。

## 11. 验收标准

本方案被认为「落地」的充要条件：

- [x] §10.2 的 owner 文档修订与实现、测试一致（2026-10-28）
- [x] 任一投影元素的写者都能用 `UI-004` / `LAYER-001` 机械判定，不依赖人工评审
- [x] 任一颜色取值都能追到 `UI_COLORS` 或 CSS token 之一：TS 侧零硬编码；CSS 侧颜色全在 token 块内
      （取值分歧见 §5.1.1，属产品决策而非绕过 token）
- [ ] 音量路径有真实浏览器采样，且进入 `runtime-performance-policy.json`
      （诊断字段已就位，Chrome workload 未注册）
- [x] `test:unit` 在 pre-push 中执行
- [x] `docs:check`、`verify`、`typecheck`、`test:unit` 同时通过

## 12. 未决项与失效条件

仍未完成：度量未闭环（可观测性已打通，见下）、badge 静音误显、pre-push 已补但仅 SPECTRA、
公开同步工具链损坏、6 项真实 Chrome 取证不在 CI、**Options 与 Popup 仍是两套 token**（§5.1.1）。

度量现状（2026-10-28 更新）：`getPopupControlDiagnostics()` 现在输出
`popupControlSettleSamples` / `P50Ms` / `P95Ms` / `MaxMs`，即 intent → settled 的
真实往返延迟，随现有诊断端口可读。**仍缺**的是注册进 `runtime-performance-policy.json`
的 Chrome workload——策略要求每指标 20 样本 × 2 次独立运行，本轮没有可执行的 Chrome 采样窗口。

出现以下任一情况，本方案必须重审而不是打补丁：

1. 需要给颜色增加第二种语义；
2. 需要在同一投影面引入第二个写者；
3. 需要让 `generation` 参与授权而不仅是排序；
4. 需要合并任意两台状态机；
5. 需要在 native 字段上删除（而非降级）稳定化证明。
