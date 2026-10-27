---
type: explanation
status: draft
audience: contributor
owner: spectra
last_reviewed: 2026-10-28
---

# SPECTRA 架构审计 2026-10-26（合并版）

本文合并了 2026-10-26 至 10-27 期间产出的 14 份审计与设计文档，以及 1 个可执行证明脚本。
它们原先存放在仓库根目录的 `artifacts/`，被 `.gitignore` 排除，也不在
[NEXUS documentation](../README.md) 的权威体系内——任何按 [AGENTS.md](../../../AGENTS.md)
入口读取仓库的会话都读不到它们，于是每次都要重新审计一遍，产出第二套平行的分析。

**本文不是行为权威。** 已落地的行为由契约、测试、门禁与领域 owner 文档定义；
本文只保留「当时的证据、被推翻的假设、以及为什么推翻」。
若本文与 [Control architecture](../../apps/extension-spectra/docs/control/README.md) 冲突，
以后者为准。

## 1. 证据边界

方法：12 组证明直接 `import` 真实源码模块运行，不重写被测逻辑，共 32 条断言，0 条证伪。
证明脚本已删除——它断言的是「缺陷存在」，修复后必然反向失败；等价断言现已由
`test/audio-session-phase.transitions.spec.ts` 等 spec 以回归形式持有。

已知边界，读结论前必须先读这一段：

| 边界 | 影响 |
|---|---|
| `remote-service`（991 行）、`control-coordinator`（2533 行）只有阅读证据，无单测 | 这两处的结论是推断，不是证明 |
| 6 项需真实 Chrome + 媒体/性能采样 | 未进 CI，属取证缺口而非代码缺陷 |
| 审计期间的三次检索方法失败（见 §8） | 部分早期结论建立在检索结果上，已逐条重做 |

## 2. 问题登记：67 项（原册口径）

| 状态 | 数量 | 说明 |
|---|---|---|
| 已修复 | 44 | Critical 6 / High 22 / Medium 12 / Low 4 |
| 撤销 | 22 | 不成立、是规格、不可达、不增加暴露面 |
| 已删除 | 1 | SP-66 `applying` 死状态 |
| 未修 | 0 | — |
| **合计** | **67** | 按域：会话生命周期 15、视觉层 6、安全域 10、传输并发 7、有界性 6、契约校验 8、数据一致性 9、发布门禁 5 |

**撤销名单**（原册写 22 项，但名单实列 23 个编号，见下方注）：
SP-01 / 02 / 06 / 12 / 14 / 20 / 21 / 22（第一至三轮）、
SP-09 / 11 / 35 / 37 / 42 / 70 / 83（第五轮）、
SP-13 / 23 / 38 / 44 / 72 / 73 / 82 / 84（第六轮）。

> **原册在此处自相矛盾**：分布表写「44 修复 + 22 撤销 + 1 删除 = 67」，
> 而撤销名单是 8 + 7 + 8 = 23 项，44 + 23 + 1 = 68。
> 差一发生在「14 项分级内撤销 + 8 项分级前撤销 = 22」这一步——分级内实列 15 项。
> 无法从残留证据判定哪个数字对，因此这里保留两个数并标明冲突，
> 而不是替原册选一个。**这正是 §2 那条结论的又一个实例：登记表不是证据源。**

撤销占 33%。这个比例说明的不是「修得少」，而是**最初三分之一的定级不成立**：
把「可以更好」当成「有缺陷」，把「读到的分支」当成「能走到的路径」。
另有 6 项（SP-64 / 70 / 37 / 09 / 80 / 81）**登记时的描述本身就是错的**——
覆盖范围写反、抑制是规格、`isTrusted` 恒为 false、检查对象错位。

结论：**登记表不是证据源，是待核清单。** 任何「N 项待修」的说法，在逐条核过之前都不算数。

## 3. 现状模型

### 3.1 五台真状态机（数量由身份轴决定，不由业务数量决定）

| 机器 | 身份轴 | 权威位置 | 守卫 |
|---|---|---|---|
| `AudioSession` | tab + doc + origin | Offscreen audio-host | 有 |
| `FieldTransaction` | tab + doc + field | Background control-coordinator | 有：`baseRevision` 单调 + `StaleControlRevisionError` |
| `RemoteSession` | session + epoch | Offscreen（Background 仅投影） | Offscreen 有，Background 无 |
| `CaptureAdmission` | admission id | Background capture-admission | 有，且是全仓范本 |
| `SiteEligibility` | 域名（持久化） | Background eligibility-cache | 三态 + manual 锁 |

**「能不能合成一个」的答案是：不能。** 五条身份轴互不相容，合并只会产生更大的错配。

### 3.2 八个有界过程（不是状态机，别建迁移表）

runtime loader、offscreen coordinator、手势回放通道、手势合流器、AB 循环调度、
visualizer 订阅、媒体探测池、popup 控制端口。

共同形态是**单飞 + 引用计数 + 单调水印 + TTL**；缺的是超时与上限，不是迁移表。
范本是 `capture-admission.ts`：先 `admissions.delete` 再校验（fail-closed）、128 容量、
15s TTL、fence epoch、11 项结构化失败原因。

### 3.3 三处违规派生（串色与分叉的共同根因）

1. badge 自持 `badgeState` + `BadgeAuthority` 双源仲裁；
2. Content Capture 镜像自持 generation/phase 并直写；
3. DOM 承载态七类：`input.value`、`classList`、`dataset`、`style` CSS 变量、
   `disabled/aria-*`、Shadow DOM、`:popover-open`。

七类里**唯一真实成问题的**是 dim-overlay 的 `attachShadow({mode:'closed'})`（外部不可测），
已于第十一轮改为 `open`。视频域的 PiP / 全屏 / 旋转角已有 TS 承载，属合理观测，不是缺陷。

## 4. 设计 v4 的归宿：哪些落地、哪些没落地

设计 v4 从未整体落地。落地的是其中四个局部机制：

| 组件 | 状态 | 锚点 |
|---|---|---|
| `Fact<V,P>` 统一原语 | **部分落地**：`Verdict<T>` / `Rejection` / `accept` / `reject` 已实现并导出（`packages/contracts/src/fact.ts`），`Fact` 本体未实现 | `fact.ts` |
| `Bounded`（cap / ttlMs / sweep） | 已落地 | `packages/contracts/src/bounded.ts` |
| `ProcessorAck` | 已落地 | 8 个源文件 |
| `NativeWriteConfirmation` | 已落地 | 2 个源文件 |
| `canDriveSideEffects`（epoch + 连接窗口守卫） | 已落地 | 2 个源文件 |
| `withDeadline` | 已落地 | 11 个源文件 |
| 写入与确认分离（written → confirmed / drifted / unconfirmed） | 已落地，2026-10-28 | [05 §11.1](../../apps/extension-spectra/docs/control/05-control-state.md)、SCTRL-045..048 |

**视觉层的原设计已撤回。** 它曾主张「三值 → 三轴正交 + 8 token」，
但这与 [03 UI and boundaries](../../apps/extension-spectra/docs/control/03-ui-and-boundaries.md) 冲突：
颜色与**已确认的用户结果**一比一对应，不表达处理器拓扑（`blue` 非 Capture 已 ACK、
`purple` 仅 `active` ACK、`gray` 静音/0）。据此撤销 SP-20 / 21 / 22：
`stopping` 显示 blue 是文档要求，`volume=0` 显示 gray 是文档要求。

保留为可测不变量：

> 颜色是「确认后的用户结果」的函数，**且不是处理器类型的函数**。
> 任何让 `purple` 出现在非 `active` ACK 之下的改动都是缺陷。

## 5. 不变量 15 条：逐条判定现状

| ID | 内容 | 现状 |
|---|---|---|
| INV-1 | `active` 无法在没有 `ProcessorAck` 时被构造 | 成立 |
| INV-2 | ACK 需过 intent 存活 + nonce + 序号三项复核 | 成立 |
| INV-3 | `version` 只排序，不得据其豁免证据校验 | 成立 |
| INV-4 | 建立路径与更新路径受同等校验 | 成立 |
| INV-5 | 未知/非法相位必须拒绝，不得由其他字段推断 | 成立 |
| INV-6 | 过渡态必须有同代合法入口 | 成立 |
| INV-7 | 停止不需 change generation，`active → stopping` 同代合法 | **作废** |
| INV-8 | 对外投影键清单与校验器键清单是同一份 | 成立 |
| INV-9 | 视觉状态由权威快照单点派生，`mode` 由 ack 派生 | 成立（原 SP-22/23 归因失效） |
| INV-10 | 视觉投影全域穷尽、无默认分支 | 成立（原 SP-20 归因失效） |
| INV-11 | 发送方校验缺失即拒绝（fail-closed） | 成立，由 G6 守 |
| INV-12 | 有界容器必须声明 `cap` / `ttlMs` / `sweep` | 成立，尚无门禁 |
| INV-13 | 物理权威必须暴露可回查证据 | 成立 |
| INV-14 | 同一语义的类型/校验器全仓唯一 | 成立，由 G1 守 |
| INV-15 | 公开投影漂移必须被自动检测 | **修正**：收敛式检测（G7），不是等式 |

**INV-7 为什么作废**：现行 oracle 在同代矩阵里明确拒绝 `active → stopping`
（`test/audio-session-phase.transitions.spec.ts` 的 `sameGenerationOracle.active` 第 4 列为 `false`）。
总册原文同时写着 INV-7「同代合法」和验收向量 3「SP-06 撤销，同代 `active→stopping` 本就应拒绝」，
两者不能同时为真；以 oracle 为准，INV-7 删除。停止必须换 generation。

## 6. 明确不做的事（v4 设计原文，仍然有效）

1. **不合并 5 台状态机。** 身份轴不同（`tab+doc+origin` / `tab+doc+field` / `session+epoch` /
   `admission id` / 域名），合并只会产生更大的错配。
2. **不给 8 个有界过程建迁移表。** 它们是单飞 + 引用计数 + 单调水印 + TTL，
   缺的是超时和上限。
3. **不消灭 DOM 承载态。** UI 必须用 DOM。只约束方向：权威 → DOM 单向写；
   DOM → 用户事件 → intent 单向读一次；**禁止从 DOM 读回当真值再参与计算**（G8 即此条）。
4. **不用类型系统单独根治 F-2。** 端到端属性只有端点能判，Background 侧的复核是必需的另一半。
5. **不动 SPECTRA 与 HALO 的共享契约边界。** HALO 不在本轮范围。

## 7. 门禁 G1–G8

全部已就位。总册写的路径是简称，实际都在 `nexus/scripts/verify/`：

| 门禁 | 检查 | 脚本 |
|---|---|---|
| G1 | 同一类型名不得两处声明 | `check-declaration-ownership.ts` |
| G2 | 结构相同的接口不得重复定义 | `check-shape-duplication.ts` |
| G3 | 协议响应校验器单一 owner | `check-content-response-coverage.ts` |
| G4 | 入队 RPC 必须包 `withDeadline` | `check-rpc-deadlines.ts` |
| G5 | 转移矩阵语义检查 | `audio-session-phase.transitions.spec.ts` |
| G6 | `sender.id` 严格比较，禁 `&&` 短路 | `check-sender-verification.ts` |
| G7 | 公开投影漂移检测（收敛式） | `check-public-parity.ts` |
| G8 | popup 控件值不得由 DOM 读回计算 | `check-ui-authority.ts` |

最该记住的一条：**一次性的模式匹配不是修复，是可复现的疏漏。**
G6 建立当天就补出 3 处真实缺口——两处把参数写成 `_sender`，一处根本没看发送方，
全部躲过了「搜 `sender.id &&`」这种检查。花名册式改 18 处再声明改完，
和让机器每天拒绝第 19 处，是两件不同的事。

## 8. 未决项（2026-10-28）

| # | 项 | 性质 | 锚点 |
|---|---|---|---|
| 1 | 度量未闭环 | **部分完成（2026-10-28）**：`getPopupControlDiagnostics()` 已输出 `popupControlSettleSamples / P50Ms / P95Ms / MaxMs`（intent → settled 往返），随现有诊断端口可读；**仍缺**注册进 `runtime-performance-policy.json` 的 Chrome workload（策略要求 20 样本 × 2 次独立运行） | `src/background/popup-control-port.ts` |
| 2 | badge 静音误显 | **已关闭（2026-10-28）**：根因不是取值来源，而是**跨文档陈旧投影**——旧文档的 `M` 被当作「最后真实 ACK」保留到新文档，而新文档从未在此被确认过。规则改为：能比对新旧 `documentId` 时清除；无法比对（worker 重启）时保留。7 条测试，含用户症状的直接复现 | `src/background/handlers/badge.ts` |
| 3 | 冻结条件仍内联在 `state.ts` | **已关闭（2026-10-28）**：提炼为 `shouldHoldVolumeTone()` / `crossesVolumeRoute()`，边界引用 `CONTROL_VALUE_LIMITS.volumeBase.max`，8 条独立断言 | `packages/contracts/src/volume-presentation.contracts.ts` |
| 4 | pre-push 缺 `test:unit` | **已关闭（2026-10-28）**：`lefthook.yml` 新增 unit-tests（118 文件 / 11s）。同时修复运行器挂死：任一文件超时即杀并点名，门禁不再无限等待 | `lefthook.yml`、`scripts/run-tests.ts` |
| 5 | `bun run sync-spectra` 损坏 | **已修（待提交生效）**：真因不是 allowlist 缺项，而是 `i18n-assets.ts` 用无扩展名导入，与 `.ts` allowlist 无法匹配；已统一为显式 `.ts` 并登记 `i18n-source-catalog.ts`。注意 sync 校验的是 **HEAD 提交内容**，提交后才生效 | `scripts/sync-public.ts`、`apps/extension-spectra/scripts/i18n-assets.ts` |
| 6 | 6 项真实 Chrome 取证 | 非代码缺陷，但不在 CI，无法防回归 | 集成测试 |
| 7 | 视觉数值曾冻结 | 已修，证据见 [音量时延](2026-10-28-spectra-volume-latency.md) | `src/popup/card/render.ts` |

### 唯一存在的真实采样（2026-10-27，Chrome 152，head `aee2cec`）

| 指标 | p50 | p95 | p99 |
|---|---|---|---|
| `hotkey.long-session.batch20-e2e` | 71.97ms | 79.59ms | 104.53ms |
| `renderer-task-time` | 98.15ms | 103.94ms | 207.86ms |
| `long-task-count` | 0 | 0 | 0 |
| `heap-used` | 1.81MB | 1.84MB | 1.84MB |

采样管线本身可用（真实 Chrome、20 批长会话、业务断言 4/4 通过），
但**没有任何音量路径的 metric**——这正是第 1 项缺口的准确形状：
不是「不会测」，是「没测那一条」。


## 9. 方法论纠错（比结论更值得保留）

1. **一次性的模式匹配不是修复**——见 §6。
2. **登记时的描述本身不可靠**——6 项形态写错，22 项根本不成立。
3. **把刻意的设计读成缺陷**——相位矩阵的 25 条边、badge 静音灰，都曾被当成 bug。
4. **文档滞后会自我验证**——曾两次把 3 个秒级纯逻辑失败记成「浏览器取证类」，
   因为没人重跑；直到补跑才暴露。

## 10. 原始文档去哪了

14 份文档（审计 P1–P10、全量枚举、逐行通读 5 条 Critical、44 项总账、设计 v1–v4、
外部边界与供应链、框架对表、首轮实证、改造面统计）与 1 个证明脚本已在 2026-10-28 删除，
本文件是它们的唯一留存。合并原则：保留仍然成立的结论与被推翻的原因，
删除施工流水账（原 §3.3–3.13 的十余轮「改了什么」），以及互相矛盾的规格描述。
