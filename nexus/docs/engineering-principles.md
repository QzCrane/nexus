---
type: explanation
status: stable
audience: contributor
---

# NEXUS 工程原则与 Markdown 文档索引

> 分析日期:2026-07-20
> 覆盖范围:仓库全部 36 个 Markdown 文件,核心原则按主题拆分到 `principles/` 子目录。
> 目的:把历史回归、架构规范、隐私承诺、发布要求和规划文档收敛为一套可执行原则。

## 1. 结论先行

NEXUS 的共同工程主线是:单一事实源、明确所有权、真实 ACK、事件驱动、按需付费和可验证的生命周期。

SPECTRA 的控制问题必须按"字段/媒体/文档/运行时"建模,不能再用一个整页模式、两份互相冲突的站点列表或一份 UI 预测值代表全部状态。HALO 的工具问题必须按"清晰插件边界、Manifest/Registry SSOT、本地优先和原子生命周期"建模。发布和商店文案必须服从实际权限、网络流量和浏览器能力边界。

## 2. 文档权威层级

同一规则冲突时按以下顺序裁决:

1. `AGENTS.md`、`CLAUDE.md`、`rules.md`:仓库级工作流、安全、测试、依赖和 Git 约束。
2. SPECTRA `docs/control-architecture.md`:媒体、音频、视频、站点适配器和远程控制的唯一规范所有者。
3. SPECTRA `docs/protocols.md`、`docs/architecture.md`、`docs/remote-security.md`、`docs/cors-data-flow.md`:分别细化跨上下文协议、运行时所有权、远程认证和 WebAudio 来源准入;不得维护第二份策略矩阵。
4. ~~SPECTRA `docs/bidirectional-sync-principles.md`、`docs/policy-decision.md`~~:9 行入口索引已删除(合并入 `control-architecture.md` 对应章节);不要新建空壳入口文件。
5. `regression-recovery-*` 与 `optimization-review-*`:已归档至 `apps/extension-spectra/docs/_archive/2026-Q3/`,作为历史根因和发布证据,不是当前行为的规范所有者。
6. `plan.md`、市场调研、README、商店文案:规划、产品定位或对外说明,不能反向定义运行时行为。
7. `PRIVACY.md`、`store-listings/privacy-justifications.md`:隐私与权限申报;必须和实际发布包、远程站点及网络流量保持一致。

规则文档不应复制完整决策表。新规则只在唯一 owner 文档落一份,再从其他文档链接过去。

本文件自身是原则索引、文档地图和漂移检查清单,不是 SPECTRA 运行时的第二个 owner。若本文件与 owner 文档出现行为描述差异,以对应 owner 文档和已验证的 Contracts 为准;这里只保留可审计的原则编号与映射。

### SPECTRA 主题 owner

| 主题 | 唯一规范来源 | 其他文档允许保留的内容 |
| --- | --- | --- |
| 媒体策略、route、writer、ACK、Toast、快捷键、PiP/fullscreen、站点 adapter、UI 语义 | [`control-architecture.md`](../apps/extension-spectra/docs/control-architecture.md) | 链接、测试证据、历史复现 |
| 跨上下文 request/event/response、READY、lease 和边界 payload | [`protocols.md`](../apps/extension-spectra/docs/protocols.md) | 精确 wire 示例与兼容说明 |
| Context 所有权、加载拓扑、存储/缓存位置 | [`architecture.md`](../apps/extension-spectra/docs/architecture.md) | 组件地图与导航表 |
| 远程认证、HMAC、PeerJS/offscreen 会话 | [`remote-security.md`](../apps/extension-spectra/docs/remote-security.md) | 隐私披露和测试证据 |
| WebAudio 来源准入、CORS/DRM 终止边界 | [`cors-data-flow.md`](../apps/extension-spectra/docs/cors-data-flow.md) | 算法证据和回归测试 |
| 当前提交范围与历史测试结果 | [`development-sync-2026-07-19.md`](../apps/extension-spectra/docs/development-sync-2026-07-19.md) / [`regression-recovery-2026-07-18.md`](../apps/extension-spectra/docs/regression-recovery-2026-07-18.md) | 日期、commit、验证快照 |

## 3. 工程原则索引(EPR-001..029)

本文件**不再持有完整原则正文**。每条 EPR 的完整定义、依据和反例落在 `principles/` 子目录对应主题文件,本节只做编号 + 1 行摘要 + 跳转。

> 引用规则:新增原则只允许落在主题子文件 + 此处索引中,不在此重复内容。

### 主题索引

| # | 文件 | 主题 | EPR 范围 |
|---|------|------|----------|
| 01 | [principles/01-state-and-ownership.md](principles/01-state-and-ownership.md) | 状态、所有权、ready 屏障、writer 唯一、策略顺序、route | EPR-001..009 |
| 02 | [principles/02-operations-and-safety.md](principles/02-operations-and-safety.md) | 不可逆准入、观察、事务、媒体语义、归因、生命周期、快捷键、UI、频谱 | EPR-010..018 |
| 03 | [principles/03-runtime-and-quality.md](principles/03-runtime-and-quality.md) | 热更新、错误结构、边界、远程、隐私、性能、模块 | EPR-019..025 |
| 04 | [principles/04-process-and-quality.md](principles/04-process-and-quality.md) | 测试、提交闭环、文案真实性、Git/CI/AI 钩子 + 运行时检查清单 | EPR-026..029 |
| 05 | [principles/05-problem-to-principle-map.md](principles/05-problem-to-principle-map.md) | 历史问题 -> 长期判定标准映射表 | §4 全文 |

### EPR 摘要

| ID | 1 行摘要 | 主题文件 |
|----|----------|----------|
| EPR-001 | 单一事实源:每个领域一个 authority,旧别名只读迁移 | [01](principles/01-state-and-ownership.md) |
| EPR-002 | Desired/Actual/ACK/Snapshot/UI 五层分离,setter 非 ACK | [01](principles/01-state-and-ownership.md) |
| EPR-003 | ACK 必须绑定 tab/document/origin/generation 身份 | [01](principles/01-state-and-ownership.md) |
| EPR-004 | READY 是能力屏障,初始化期不能发布 ready | [01](principles/01-state-and-ownership.md) |
| EPR-005 | 同一文档只能有一个可写 Runtime,token/lease 释放 | [01](principles/01-state-and-ownership.md) |
| EPR-006 | `{document, media, field}` 单 writer,禁通用 MAIN | [01](principles/01-state-and-ownership.md) |
| EPR-007 | 按能力 native-first,UI 不要求用户选 Native/WebAudio | [01](principles/01-state-and-ownership.md) |
| EPR-008 | Capture 仅服务 full-output DSP,非默认入口 | [01](principles/01-state-and-ownership.md) |
| EPR-009 | 一网站一 route,缓存选路不代表激活 | [01](principles/01-state-and-ownership.md) |
| EPR-010 | 不可逆操作先证明准入,CORS/DRM/activation 是终止错误 | [02](principles/02-operations-and-safety.md) |
| EPR-011 | 纯观察不能装 listener/写设置,observation commit 显式 | [02](principles/02-operations-and-safety.md) |
| EPR-012 | 控制事务串行,字段失败互不吞没、各自 rollback | [02](principles/02-operations-and-safety.md) |
| EPR-013 | 选择/恢复/观察三语义分离,activeMedia != activeVideo | [02](principles/02-operations-and-safety.md) |
| EPR-014 | 页面事件先归因再选 target,扩展写入不能伪装用户 | [02](principles/02-operations-and-safety.md) |
| EPR-015 | PiP/fullscreen 只走标准 API + 真实 activation | [02](principles/02-operations-and-safety.md) |
| EPR-016 | 快捷键/反馈是显式生命周期,keyup 取消 repeat | [02](principles/02-operations-and-safety.md) |
| EPR-017 | UI 文本/图标/状态用 i18n key,reset/restore 分开 | [02](principles/02-operations-and-safety.md) |
| EPR-018 | 频谱订阅只消费 active processor,无 processor 不创建 | [02](principles/02-operations-and-safety.md) |
| EPR-019 | 热更新/导航/重启可恢复,lease 由 Background 唯一管理 | [03](principles/03-runtime-and-quality.md) |
| EPR-020 | 错误结构化(code+message+retryable+phase+链路 id) | [03](principles/03-runtime-and-quality.md) |
| EPR-021 | 消息/URL/QR 先校验再执行,secret 不入公开 metadata | [03](principles/03-runtime-and-quality.md) |
| EPR-022 | 远程控制默认关闭,HMAC 成功前不发送状态 | [03](principles/03-runtime-and-quality.md) |
| EPR-023 | 隐私承诺必须匹配物理流量,显式 opt-in | [03](principles/03-runtime-and-quality.md) |
| EPR-024 | 性能优化不能替换正确性,可测指标必带 | [03](principles/03-runtime-and-quality.md) |
| EPR-025 | 模块高内聚单向依赖,目录/文件大小是可维护性信号 | [03](principles/03-runtime-and-quality.md) |
| EPR-026 | 测试覆盖时序与真实浏览器语义(单元/契约/状态机/Chrome) | [04](principles/04-process-and-quality.md) |
| EPR-027 | 每个 commit 一个可回滚闭环(契约+实现+测试+文档) | [04](principles/04-process-and-quality.md) |
| EPR-028 | 对外文案不超过已证明能力,绝对句式需发布门证明 | [04](principles/04-process-and-quality.md) |
| EPR-029 | 质量门硬化到 Git/CI/AI 钩子,文档风格靠 lint 守 | [04](principles/04-process-and-quality.md) |

## 4. 之前问题的原则化映射

完整表格见 [`principles/05-problem-to-principle-map.md`](principles/05-problem-to-principle-map.md)。新增历史问题请追加到该子文件,不在此重复。

## 5. 运行时检查清单

完整清单见 [`principles/04-process-and-quality.md` § 5](principles/04-process-and-quality.md#5-运行时检查清单)(改前 / 改后 / 发布前)。

## 6. 全部 Markdown 文档索引

### 仓库治理与入口

- [`/AGENTS.md`](../../AGENTS.md):GitNexus、修改前影响分析、提交前变更审计。
- [`/CLAUDE.md`](../../CLAUDE.md):与 `AGENTS.md` 重复的 GitNexus 工作流入口;两者应保持一致(NTFS 硬链接)。
- [`/rules.md`](../../rules.md):安全、依赖、模块边界、测试、性能、文档和 Git 规则。
- [`/README.md`](../../README.md):根目录代理入口和工作目录边界。
- [`/spectra.md`](../../spectra.md):SPECTRA 恢复与闭环实施规范;适合作为问题分析/测试时序手册,不替代当前控制架构 owner。

### NEXUS 工作区与产品治理

- [`README.md`](../README.md):monorepo 项目入口 + AI 入口(原 README.AI.md 内容已合并)。
- [`plan.md`](../plan.md):NEXUS 产品路线。
- [`docs/business-model.md`](business-model.md):商业模式与本地隐私定位。
- [`apps/extension-halo/PLAN.md`](../apps/extension-halo/PLAN.md):HALO 唯一规划/架构 owner(原 plan.md / docs/architecture.md / docs/halo-dev-flow.md 已合并)。

### 工程原则子目录(本文件的下属)

- [`principles/01-state-and-ownership.md`](principles/01-state-and-ownership.md):EPR-001..009(状态/SSOT/READY/writer/策略/Capture/route)
- [`principles/02-operations-and-safety.md`](principles/02-operations-and-safety.md):EPR-010..018(不可逆/观察/事务/语义/归因/生命周期/快捷键/UI/频谱)
- [`principles/03-runtime-and-quality.md`](principles/03-runtime-and-quality.md):EPR-019..025(热更新/错误/边界/远程/隐私/性能/模块)
- [`principles/04-process-and-quality.md`](principles/04-process-and-quality.md):EPR-026..029 + 运行时检查清单
- [`principles/05-problem-to-principle-map.md`](principles/05-problem-to-principle-map.md):历史问题 -> 长期判定标准

### SPECTRA 规范、证据与产品资料

- [`apps/extension-spectra/docs/control-architecture.md`](../apps/extension-spectra/docs/control-architecture.md):唯一控制架构 owner,按 progressive disclosure 拆分为 8 主题子文件(`control/01..08`),本文件只做章节映射。
- [`apps/extension-spectra/docs/architecture.md`](../apps/extension-spectra/docs/architecture.md):Runtime context 所有权和加载拓扑。
- [`apps/extension-spectra/docs/protocols.md`](../apps/extension-spectra/docs/protocols.md):跨上下文 state/message/lease 协议。
- [`apps/extension-spectra/docs/remote-security.md`](../apps/extension-spectra/docs/remote-security.md):远程配对、HMAC、命令绑定和 offscreen 集成。
- [`apps/extension-spectra/docs/cors-data-flow.md`](../apps/extension-spectra/docs/cors-data-flow.md):不可逆 WebAudio 绑定前的来源准入。
- ~~`apps/extension-spectra/docs/bidirectional-sync-principles.md`~~:9 行入口索引,已删除(合并入 control-architecture.md §Bidirectional sync)。
- ~~`apps/extension-spectra/docs/policy-decision.md`~~:9 行入口索引,已删除(合并入 control-architecture.md §Policy)。
- [`apps/extension-spectra/docs/_archive/2026-Q3/`](../apps/extension-spectra/docs/_archive/2026-Q3/README.md):2026-Q3 历史快照归档(regression-recovery / optimization-review / development-sync)。
- [`apps/extension-spectra/plan.md`](../apps/extension-spectra/docs/plan.md):SPECTRA 产品路线和历史修复记录。
- [`apps/extension-spectra/README.md`](../apps/extension-spectra/docs/README.md):功能、安装、技术栈和对外简介。
- [`apps/extension-spectra/PRIVACY.md`](../apps/extension-spectra/PRIVACY.md):本地数据、可选远程和第三方网络披露。

商店文案同构但语言不同,均纳入本次检查:

- [`apps/extension-spectra/store-listings/en-US.md`](../apps/extension-spectra/store-listings/en-US.md)
- [`apps/extension-spectra/store-listings/zh-CN.md`](../apps/extension-spectra/store-listings/zh-CN.md)
- [`apps/extension-spectra/store-listings/zh-TW.md`](../apps/extension-spectra/store-listings/zh-TW.md)
- [`apps/extension-spectra/store-listings/de-DE.md`](../apps/extension-spectra/store-listings/de-DE.md)
- [`apps/extension-spectra/store-listings/es-ES.md`](../apps/extension-spectra/store-listings/es-ES.md)
- [`apps/extension-spectra/store-listings/fr-FR.md`](../apps/extension-spectra/store-listings/fr-FR.md)
- [`apps/extension-spectra/store-listings/ja-JP.md`](../apps/extension-spectra/store-listings/ja-JP.md)
- [`apps/extension-spectra/store-listings/ko-KR.md`](../apps/extension-spectra/store-listings/ko-KR.md)
- [`apps/extension-spectra/store-listings/ru-RU.md`](../apps/extension-spectra/store-listings/ru-RU.md)
- [`apps/extension-spectra/store-listings/privacy-justifications.md`](../apps/extension-spectra/store-listings/privacy-justifications.md):权限和 Dashboard 申报唯一参考。

### HALO 架构、规划与研究

- [`apps/extension-halo/docs/architecture.md`](../apps/extension-halo/docs/architecture.md):SidePanel、插件类型、Registry、i18n 和动画系统。
- [`apps/extension-halo/plan.md`](../apps/extension-halo/plan.md):工具路线、SSOT/Atomic/Isolation/Local First 原则和待解决问题。
- [`apps/extension-halo/docs/research.md`](../apps/extension-halo/docs/research.md):市场定位、竞品痛点和技术方向。
- [`apps/extension-halo/docs/feature-gap-analysis.md`](../apps/extension-halo/docs/feature-gap-analysis.md):工具功能差距和优先级。
- [`apps/extension-halo/docs/plan-hover-zoom-v2.md`](../apps/extension-halo/docs/plan-hover-zoom-v2.md):Hover Zoom 模块化、懒加载、MSE 和后续路线。
- [`apps/extension-halo/docs/plan-danmaku.md`](../apps/extension-halo/docs/plan-danmaku.md):弹幕 Protobuf/Canvas/时间轴设计和验收标准。

### HALO 市场研究

- [`docs/market-research.md`](market-research.md):HALO 7 大功能(Dark Reader / OneTab / Lightshot / QR / SmoothScroll / Clipboard / Time Limit)竞品痛点汇总 + 差异化策略 + 交付路线(原 5 份散落调研已合并,信息零损失)。

### 独立远程站点

- [`remote-site/README.md`](../../remote-site/README.md):静态部署、Pinned PeerJS、fragment pairing、CSP/字节/MIME 发布门。

## 7. 已发现的文档漂移与处理规则

1. [`regression-recovery-2026-07-18.md`](../apps/extension-spectra/docs/_archive/2026-Q3/regression-recovery-2026-07-18.md) 的基线、当前 commit、测试数量和"待实施"状态是历史快照,已归档;修复完成后不覆盖历史数字,应新增当前验证报告或更新"已验证于"字段。
2. 两份 `optimization-review` 已声明为历史证据并归档到 `_archive/2026-Q3/`,当前实现以 `control-architecture.md`、`architecture.md` 和 `protocols.md` 为准。
3. `README.md`(原 README.AI.md 内容已合并)中的工具数量、旧版命令和公开仓库强制推送说明需要在下次发布前重新核对;不得将 `push -f` 当作默认工作流。
4. SPECTRA 商店文案中的"所有网站""零 CPU""受保护媒体稳定工作"等绝对表述超过当前结构化 unsupported 和浏览器安全边界;发布前必须改成能力范围与失败语义可证明的表述。
5. 商业模式的"零上传"必须表述为产品不运营数据收集服务;SPECTRA 可选远程的标题/域名/控制状态和第三方连接元数据必须继续按 `PRIVACY.md` 披露。
6. HALO 研究中的 Google Drive/跨设备备份属于可选外部能力,必须保留本地默认路径、最小权限和显式 opt-in,不能与"零网络请求"核心定位混为默认行为。
7. 根 `rules.md` 要求的文档压缩格式与现有架构文档的大量表格存在表达层冲突;格式偏好不能压过架构可读性,表格只保留在能降低歧义的矩阵/映射场景。
8. `AGENTS.md` 与 `CLAUDE.md` 通过 NTFS 硬链接共享同一 inode(由 `postanalyze.mjs` 维护),两者物理上不会分叉。
9. GitNexus 当前索引提示落后主分支提交,且 clusters 为空;本次文档结论以直接 Markdown/source 读取为主,重新索引后再补一次图谱审计。

## 8. 文档维护 SOP

1. 新增规则先判断它是规范、证据、规划、产品文案还是隐私政策;规范必须指定唯一 owner。
2. 代码变更先更新 Contracts/owner 规则和失败测试,再更新实现;禁止先改多个 projection 追赶一个未定义的 authority。
3. 每次发布同时检查内部文档、README、PRIVACY、store listings、remote-site 和构建产物的事实一致性。
4. 历史报告追加日期和验证范围,不回写旧 commit 的结果;当前状态另建带日期报告。
5. 自动化检查至少包括内部链接、文档索引覆盖、locale 结构、权限/隐私关键字、过期测试数字和"所有网站/零 CPU/绝不传输"等绝对承诺扫描,由 `lint-docs.mjs` + `verify:q` 共同保证。
6. 代码提交前执行 GitNexus impact/detect_changes、完整测试、Chrome smoke、生产产物检查和 `git diff --check`,由 Lefthook 钩子强制。

这份文档是统一索引和原则层,不替代 SPECTRA 的能力矩阵、协议定义、隐私政策或 HALO 的具体工具设计;它只规定这些文档如何分工、如何互相约束,以及历史问题如何转化为可验证不变量。
