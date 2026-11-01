---
type: explanation
status: stable
audience: developer
owner: spectra-system-architecture
last_reviewed: 2026-11-01
---

# SPECTRA 媒体控制系统 — 最全面系统架构

- **日期**：2026-11-01
- **范围**：SPECTRA 浏览器扩展（`apps/extension-spectra`）的整套媒体（音频 + 视频）控制系统架构。
- **目的**：把分散在 `architecture/`、`control/`、`principles/`、`proposals/`、`research/` 各处的权威文档，整合为一份自洽的系统级总览。本文是**整合与索引**，不创造第二套规范；任何与下方 owner 文档冲突处，以 owner 文档为准。
- **权威边界**：行为权威依序为 可执行契约与测试 → `control/` 主题 owner → `architecture/runtime.md` → `reference/protocols.md`。本文属架构整合，非行为权威。
- **关联文档**：抖音倍速专项分析见 `research/2026-11-01-spectra-douyin-speed-sync-root-cause.md` 与 `proposals/2026-11-01-spectra-douyin-speed-official-adapter.md`（本文 §11 引用）。

---

## 1. 设计总纲（不可协商项）

> **一个 authority，一次 ACK，一个写者，一条 Native-first 路径，证明不可删除。**

| 不可协商项 | 含义 | owner |
|---|---|---|
| 单一事实源 | 每个领域只有一个 authority；UI / badge / 缓存 / 远程端都是 projection | EPR-001 |
| ACK 分层 | `desired → actual → acknowledged → snapshot → projection`；setter 返回不是 ACK | EPR-002 / 003 |
| 唯一写者 | 每个 `{document, media, field}` 与每个投影元素只有一个写者 | EPR-006 / 006a |
| Native-first | `observe → exact DOM/Chrome native → one-shot 官方 API → 可逆增强 → structured unsupported` | EPR-007 / 008 |
| 证明不删除 | 等待可移出关键路径，但稳定化证明必须作为可观测信号保留 | EPR-002a |

派生推论：UI 永不让用户选择 native internals、MAIN bridge 或 Capture；`100%` 与 `1x` 是字面值，不是"释放控制"（`01 §1`）。

---

## 2. 运行时所有权模型（六上下文）

SPECTRA 是 Chrome MV3 扩展，运行时上下文之间**只有经过校验的端口，没有共享可变状态**。每个箭头都是 validated port，不是共享内存。

| 上下文 | 拥有 (owns) | 明确不拥有 |
|---|---|---|
| Popup / Options | intent、本地渲染、交互 | actual 音频模式、直接存储、执行器选择 |
| Content（isolated） | 文档身份、媒体注册表、DOM/CSS writer、精确 configured-site lean host、已证明的 MediaElement WebAudio 图、Capture intent/readback 投影 | Capture 构造、读回前的 active 声明、跨 tab 热键目标选择 |
| MAIN bridges | 全屏音频交接、精确元素 page-media getter/setter 读写 | 通用 dispatch、域表、跨 tab 状态 |
| Background worker | 路由、设置、快照、badge 投影、runtime lease、每文档 lean/full 热键所有权与重启恢复 | WebAudio 节点、乐观 UI |
| Unified offscreen host | 实际的 Capture 处理器、认证的 remote session | 直接文档创建/关闭 |
| Remote page | 认证后的意图提交 | 任何 actual 状态 |

`ControlSnapshot` 拥有 actual 媒体/视频/DSP 字段；`AudioSessionSnapshot`（按文档键控）拥有处理器 mode/phase/config/error。投影保留这一分离。

---

## 3. 控制事务链路（intent → 像素）

Volume 与 speed 使用**双向事务**。没有任何 surface 写另一个的 prediction。

```text
intent（Popup / hotkey / remote / page）
  → Background ControlCoordinator（每 tab 单 actor，串行）
  → 物理 owner（Content / offscreen）写入 + 读回
  → identity / generation / revision 复核
  → 提交 ControlSnapshot（持久化先确认，再广播）
  → 有界投影（card / side-panel / OSD / badge）
```

`ControlSnapshot` 是唯一的字段级 actual 权威。它拥有已 ACK 的 `volumeBase + boost` 分量、mute、speed、transport、DSP、video 字段，并携带独立的 `activeMedia`（音频）与 `activeVideo`（视频）身份。`AudioSessionSnapshot` 贡献处理器生命周期（`desiredMode/actualMode/phase/generation/error`），**永不覆盖控制字段**。

页面 `volumechange`/`ratechange` 观察只提交一次，永不回显 DOM 写入；页面音量手势把非中性 Boost 复位为 1，避免误报。

---

## 4. Native-first 策略与能力裁决

### 4.1 策略顺序

`CONTROL_ALGORITHM_POLICIES` 先过滤无法覆盖请求范围或无法读回 actual 的候选，再遵循能力固有顺序：

```text
OBSERVE → CAPABILITY-SPECIFIC NATIVE (PAGE_NATIVE / DOM_NATIVE / CHROME_NATIVE)
        → CONTROLLED AUGMENTATION (EXTENSION_STATE / CSS / OVERLAY / CAPTURE)
        → UNSUPPORTED
```

### 4.2 禁止的通用 MAIN 行为（SCTRL-004）

生产代码严禁重定义/覆盖以下全局对象：`window.AudioContext` 及其原型、`MediaElementAudioSourceNode`/`createMediaElementSource()`、HTMLMediaElement 音频输出链路、`window.Audio`/`document.createElement`、`HTMLMediaElement.prototype`、`History` API。MAIN 执行严格限定于 manifest `document_start` 注入的两个闭合 bridge：

1. **Fullscreen V1 Bridge**：包装原生全屏入口以协调增强音频手势。
2. **Page-Media V2 Bridge**：仅在目标元素上处理 `volumeBase`、`mediaMuted`、`speed`。

### 4.3 失败分级（§7.3）

| 失败类 | 代码 | 决定 |
|---|---|---|
| 能力缺口 | `capability-unavailable` / `write-unsupported` / `readback-mismatch` / `coverage-incomplete` / `source-binding-ineligible` / `strategy-runtime-failed` | 释放/绕过失败候选，尝试下一可用策略 |
| 浏览器/安全边界 | `user-activation-required` / `permission-denied` / `cors-or-drm-protected` / `protected-content` / `closed-shadow-inaccessible` / `stale-document` / `stale-media-source` / `policy-denied` | **终止**，返回结构化错误并保持稳定路径（严禁用 MAIN/Capture 伪装） |

---

## 5. 双世界模型与 Page-Media V2 桥

控制写实存在两个世界，由 page-media V2 桥跨世界同步。**这是抖音倍速 bug 的架构舞台**（见 §11）。

1. **ISOLATED 世界**（`native-media-executor.ts`）：唯一 writer，按 `declared-official → page-native → dom-native` 顺序决定写入层。前两档都经同一个桥调用，差别只在证据与归因（§5.2）。
2. **MAIN 世界**（`injector/page-media-bridge.ts`）：负责"精确元素 + 能力发现"——遍历合成祖先、扫描自有属性，寻找与媒体元素显式关联的 controller，要求其具备成对 getter/setter 且 readback 稳定。
3. **跨世界协议**（`shared/page-media-bridge.ts` + `logic/page-media-bridge.ts`）：经 DOM 属性 + 合成事件同步。ISOLATED 端 `readPageMediaField`/`writePageMediaField` 同步派发请求并读取结果；`supported===false` 或返回 `null` 视为无页面能力。桥**忠实**——仅在 `!result?.supported` 或结果 JSON 损坏时返回 `null`，不吞噬错误。

### 5.1 discovery 白名单（speed 专项脆弱点）

`findCapability('speed')` 只认以下硬编码约定：

| 维度 | 内容 | 位置 |
|---|---|---|
| setter 探测名（仅 4 个） | `getPlaybackRate`、`setPlaybackRate`、`setPlaybackRateByUser`、`changePlaybackRate`（或 `playbackRate` 访问器对） | `injector/page-media-bridge.ts:150-165` |
| 关联键（仅 7 个） | `video`/`media`/`mediaElement`/`element`（media-reference）、`root`/`el`/`container`（root-reference） | `:177-189` |
| 遍历边界 | ≤12 层合成祖先、每 host 前 96 个自有属性、≤8 层原型 | `:33-35, :197` |

> **结论（根因）**：抖音（React SPA）的 speed 控制器在上述维度上全部超出白名单 → `findCapability` 返回 `null` → 写入降级 `dom-native`。详见 §11 与根因报告。

### 5.2 声明式站点适配器（覆盖层，不是替代层）

通用启发式之上有一层**经评审的数据**：

- **数据**：`shared/site-adapter-registry.ts` 的 `SITE_ADAPTER_REGISTRY`，每条声明 hosts / field / revision / status / discovery（setter·getter·accessor 名、关联键、边界、是否走 React fiber）/ projection。纯数据模块，无 DOM、无副作用。
- **消费**：仍是那一个 allowlisted 桥。条目只重排与放宽探测，**不新增注入文件**（SCTRL-004）。候选排序把 declared 置于关联等级之前——条目存在的理由就是通用排序在这里选错了对象。
- **归因**：桥在结果里回传 `adapterId`，执行器据此把 ownership 记为 `declared-official`。wire 仍报 `page-native`（`CONTROL_STRATEGIES` 是承载位序的封闭枚举，不得扩）。
- **证人**：`projection` 是 UI 投影读取器。没有 projection 的条目只能回答 `probe`，永远不能承载写入——没有 UI 证人的写入正是这套机制要终结的形态。
- **门禁**：`status: 'candidate'` 未经 EPR-028 实机闸门，`verified` 只能由运行手册授予。

> 条目存在的安全边界不在"条目是否存在"，而在"投影是否可读"：找不到控制器 → 退回通用；找到但投影不可读 → 不写；两者都满足 → 走站点自己的 setter。所以带条目发布不会让任何站点变差。

---

## 6. 写入 / 确认 / 观察 / ledger 管线

### 6.1 写入层选取（`native-media-executor.ts`）

- `readRestorableMediaFieldForWrite`（`:286-318`）→ 无既有 ownership 时调用 `readRestorableMediaFieldWithWriter`（`:254-284`）。
- 无 ownership 且 `readPageMediaField(element,'speed')` 返回 `null` → `writer:'dom-native'`（`:273-283`）。
- `writeRestorableMediaField`（`:320-338`）对 dom-native 走 `writeNativePlaybackRate`：`element.playbackRate = next`（`:354-364`）。

### 6.2 写入与确认分离（SCTRL-045..048，§11.1）

对原生字段（`volumeBase`/`mediaMuted`/`speed`），**物理写入**与**稳定证明**是两个不同事实：

| `writeState` | 含义 | 事务可否作答 |
|---|---|---|
| `written` | setter 已执行，元素当前反映请求值 | 可以 |
| `confirmed` | 经事件静默窗（`NATIVE_EVENT_QUIET_MS = 64`）+ 两个渲染边界后仍成立 | 可以 |
| `drifted` | 页面在写入后恢复为别的值 | 回写 observed actual，按站点计入 ledger |
| `unconfirmed` | 稳定化未结束（中止 / DRM 无事件 / 超时） | **不是失败**：不报错、不补偿 |

约束：证明在事务作答之后以可取消后台任务运行；更新的写入取消上一个写入的证明（`SCTRL-046`）；`drifted` 累计达阈值即降级为"先证明后作答"。被降级的是**等待**，不是**顺序**。

### 6.3 诊断可观测性缺口（关键架构缺陷）

`native-write-confirmation.ts:readActual` 对 speed 为 `element.playbackRate`（`:40`）。**写入确认、事件观察（`handleMediaEvent`）、per-site ledger 全部只读 DOM 属性**。对"UI 由 React state 驱动"的站点（抖音），DOM 与 UI 投影分叉，而系统只测 DOM → 永远 `confirmed`、永不 `drifted`、永不自愈。本架构的总修复方向见 §11 与适配器方案。

---

## 7. 字段能力与算法矩阵（51 capabilities）

`CONTROL_ALGORITHM_POLICIES`（`packages/contracts/src/control.contracts.ts`）是 executable `Record<ControlCapability, ControlAlgorithmPolicy>`，拥有 scope、kind、strategies、ACK source、MAIN policy、work rules。缺失策略即编译错误。

### 7.1 家族分布

17 native-only、6 hybrid、26 augmentation-only、2 observation-only（共 51 capabilities）。`CONTROL_FIELDS` 28 个持久/可观察字段，`CONTROL_OPERATIONS` 23 个瞬时操作。

### 7.2 关键字段路由（与本文最相关）

| Capability | Native 裁决 | 有序策略 | MAIN 准入 | ACK 证据 |
|---|---|---|---|---|
| `speed` | native-only | `declared-official → page-native → dom-native` | `exact-element-page-bridge` | `page-controller-getter + dom-event-getter`（声明式路由再加 UI 投影证人） |
| `volumeBase` | native-only | `page-native → dom-native` | `exact-element-page-bridge` | 同上 |
| `mediaMuted` | native-only | `page-native → dom-native` | `exact-element-page-bridge` | 同上 |
| `preservePitch` | native-only | `dom-native` | forbidden | `dom-stable-getter` |
| `effective-volume` | hybrid | `page-native → dom-native → extension-state → media-webaudio → capture` | `exact-element-page-bridge` | 上述组合 |
| `boost` / `eqValues` / `bass` / `compressor` / `mono` / `pan` / `delay` | augmentation-only | `media-webaudio → capture` | forbidden | `processor-readback` |
| `visualizer` | observation-only | 安全页面 WebAudio 或已有 DSP Capture 观察 | forbidden | `subscription-state` |

`ALG-050`（Page-media bridge）：native-control，同步精确元素发现，扫描 ≤12 祖先、无保留循环。`ALG-049`（Effective-vol txn）：精确页面 controller 先承接 `0–800`；DOM `0–100`；高于 100 且页面拒绝才用 MediaElement WebAudio Boost，Capture 仅用于不完全/不安全覆盖。

### 7.3 源码审计

`scripts/verify/check-spectra-control.ts` 确认每个 anchor 与顺序 ID `ALG-001` 至 `ALG-050`。每条能力都有"实现锚点"（如 `page-media-bridge.ts::findCapability/transact`、`native-media-executor.ts::releasePageSettings`），变更能力必须同步更新 adjudication、anchors、mirror、测试。

---

## 8. 音源准入与三态处理器

`bypass → webaudio → capture` 是规范顺序（`media-source-admission.md`）：

1. **bypass**：原生页面/DOM writer 拥有中性音频；无 `AudioContext`、analyser、offscreen 文档或 tab stream。
2. **webaudio**：每个元素一个 isolated-world、页面生命周期 `MediaElementAudioSourceNode` 喂入共享稀疏图。仅当每个当前处理源在首次不可逆绑定前被证明安全时才允许。`MediaRegistry.listProcessingSources()` 拥有该集合：selected URL 或非空 `srcObject`。
3. **capture**：一次性扩展调用 admission 在页面覆盖不完整/不安全/受保护或绑定/读回失败时获取完整 tab 混音。

`WebAudioController` 是完整安全媒体的页面处理器 owner；`offscreen/audio-host.ts` 是全标签 Capture owner。两者共享 `AudioGraphRouter` 语义但不共享物理 source。候选必须先构造图、再确认 `running`/`graphSignature`/`normalizedActualConfig`/`sourceCount`；未通过 readback 不得发布 active。

`CaptureAdmission` 必须绑定 `tabId`、`frameId:0`、`documentId`、document/worker epoch、过期时间与 `oneShot:true`；普通页面状态不能伪造或续用（`SCTRL-008`、`SCTRL-041`）。

---

## 9. 快照与投影分工

| 快照 | 拥有 | 不得做 |
|---|---|---|
| `ControlSnapshot` | 已 ACK 的 `volumeBase+boost`、mute、speed、transport、DSP、video 字段 | 不携带处理器生命周期 |
| `AudioSessionSnapshot` | `desiredMode/actualMode/phase/generation/error` | 永不覆盖控制字段 |
| tab-session record | 20 个可刷新恢复字段的持久化投影（`CONTROL_SESSION_FIELDS`） | 只存 actual，不存默认值 |

有效音量是**完整 ACK 对**（`volumeBase + boost`）的投影，不是独立字段；`volume`/`volumeBase`/`boost` 构成同一 canonical 值对象，任何局部 patch 先合并再规范化。`ControlSnapshot` 携带独立的 `activeMedia`（音频）与 `activeVideo`（视频）身份——视频专用 surface 路由到 `activeVideo`（`SCTRL-025`）。

投影持久化：`merge`/`rebind` 仅在 `chrome.storage.session` 确认后返回；设置 revision 仅在 `chrome.storage.local.set` 后广播。内存/计时器是清理辅助，不是持久性。

---

## 10. 安全不变式与编号命名空间

### 10.1 精选 SCTRL（与本文最相关）

| 编号 | 不变式 |
|---|---|
| `SCTRL-003` | 每个 `{document, media, field}` 只有一个 writer；`native-media-async.ts` 拥有物理异步 setter/readback，`native-media-executor.ts` 拥有目标与回滚编排，绝无第二个 setter |
| `SCTRL-004` | 禁止通用 MAIN monkey-patch；Fullscreen V1 与 Page-Media V2 是仅有的 `document_start` allowlisted 注入 |
| `SCTRL-015` | MAIN 不能绕过 user activation、CORS、DRM 或不可访问媒体 |
| `SCTRL-027` | 原生候选准入与 ACK 是 one-shot；拒绝的成熟恢复页面基线与先前 DOM 状态 |
| `SCTRL-036` | 策略升级消费规范失败码；安全/激活失败是 terminal |
| `SCTRL-045` | 原生字段的物理写入与其稳定化证明是两个不同事实；事务在 setter 后作答，证明作为可取消后台任务产出 `confirmed/drifted/unconfirmed` |
| `SCTRL-046` | 更新的写入取消其取代写入的证明；已证明 `drifted` 重发页面真值并喂入 per-site ledger，使该 origin 降级到 verified 路径 |
| `SCTRL-047` | 每个投影元素只有一个写作模块，且投影面之间不得互相 import |

### 10.2 原则（EPR）精选

| 编号 | 含义 |
|---|---|
| EPR-001 | 单一事实源（每个领域一个 authority，其余是 projection） |
| EPR-002/003 | ACK 分层：`desired→actual→acknowledged→snapshot→projection`；setter 返回不是 ACK |
| EPR-006/006a | 唯一写者 |
| EPR-007/008 | Native-first 策略顺序 |
| EPR-002a | 证明不可删除（等待可移出关键路径，但证明须保留为可观测信号） |
| EPR-028 | Public Copy Truthfulness：结论须以已验证能力为界 |

### 10.3 编号命名空间（不得混用）

| 前缀 | 域 | owner |
|---|---|---|
| `EPR-xxx` | 工程原则 | `docs/principles/` |
| `SCTRL-xxx` | SPECTRA 静态不变量 | `control/08`（当前 050） |
| `ALG-xxx` | 源码算法审计 | `control/04`（当前 050） |
| `UI-xxx` | 投影权威检查 | `check-ui-authority.ts` |
| `LAYER-xxx` | 分层依赖检查 | `check-architecture-layers.ts` |
| `G1..G8` | 可执行门禁 | `scripts/verify/` |
| `SP-xx`/`INV-xx` | 历史审计登记与不变量 | 仅研究文档，非当前权威 |

---

## 11. 抖音倍速：双世界失效的具象分析

抖音倍速 UI 单向不同步是本文 §5–§6 架构在真实站点上的一次具体失效，登记于 `05-problem-to-principle-map.md:24`（EPR-007/EPR-002/EPR-028）。其根因与修复方向已完整记录在两份专项文档，此处只给结论索引：

- **根因（子因 A，已确证）**：通用 page-native discovery 的白名单（4 名 / 7 键 / 12-96-8）无法定位抖音 speed controller，写入降级 `dom-native`，而抖音倍速标签由 React state 驱动、不读 `element.playbackRate` → 正向不同步；反向（抖音 UI 改倍速）因抖音自身路径恰好也写 DOM 而正常。
- **诊断失明**：本文 §6.3 所述"全 DOM 读回"缺陷在抖音上表现为——ledger 永远 `confirmed`、永不 `drifted`，系统结构性无法感知该 bug。
- **修复（已实现）**：`shared/site-adapter-registry.ts` 的 `douyin-speed` 条目（`candidate`）+ 桥内声明式发现 + `declared-official` 内部路由。ACK 以**控制器 getter** 为据（桥内同步校验并回滚），**UI 投影作为证人**由事务后的 `auditProjection` 裁决并写入 ledger——初版设想的「投影即 ACK 前提」在实现中因 React 异步渲染而修正（见适配器方案 §12.1）。
- 详细证据、端到端因果链、实机验证清单见 `research/2026-11-01-spectra-douyin-speed-sync-root-cause.md`；架构方案、契约、注册表、安全不变式、EPR-028 验证计划见 `proposals/2026-11-01-spectra-douyin-speed-official-adapter.md`。

---

## 12. 验证体系与门禁

| 层 | 内容 | 执行入口 |
|---|---|---|
| 契约 | 51 capabilities、28 字段、23 操作 | `packages/contracts` + 契约测试 |
| 静态不变量 | `SCTRL-001..050` | `bun run verify` |
| 门禁 | G1–G8 | `scripts/verify/check-*.ts` |
| 分层与投影 | `LAYER-001`、`UI-004` | `check-architecture-layers.ts`、`check-ui-authority.ts` |
| 文档 | frontmatter、链接、owner 唯一、可达性 | `bun run docs:check` |
| 单元测试 | 逐文件隔离 | `bun run test:unit` |
| 浏览器取证 | 真实 Chrome 集成 | `bun run test:chrome` |
| 发布 | 供应链、隐私、产物 | `release-spectra.ts` |

**行为变更必须同时落到契约、实现、测试、owner 文档、门禁**；缺一项即未闭环。迁移与发布门禁的闭合顺序：`Contracts/Coordinator → Runtime Loaders → Native Writer → Page Bridge → Capture Host → Executors → UI → Retired-owner deletion`（由 `check-spectra-control.ts` 强制）。

---

## 13. 引用索引

| 文档 | 本文引用章节 | 角色 |
|---|---|---|
| `architecture/runtime.md` | §2, §3, §9 | 运行时所有权、音频生命周期、offscreen、诊断权威 |
| `control/01-foundations.md` | §1, §3, §9 | 产品语义、控制流与状态所有权 |
| `control/02-strategy-and-routes.md` | §4, §5 | 策略顺序、禁止 MAIN 行为、Capture admission、五组快捷键 |
| `control/03-ui-and-boundaries.md` | §4.3, §7.3, §9 | UI 边界、策略准入、失败升级、可选权限 |
| `control/04a-algorithm-matrix.md` | §7 | 完整能力矩阵与 executable mirror |
| `control/04b-source-algorithms.md` | §7.3 | 已审计源码算法与 retired/forbidden 清单（ALG-001..050） |
| `control/05-control-state.md` | §3, §6.2 | 字段状态机、写入/确认分离、音源处理 |
| `control/08-invariants-and-gates.md` | §4.2, §10.1 | SCTRL-001..050 与迁移/发布门禁 |
| `architecture/media-source-admission.md` | §8 | 三态处理器与 Capture admission 证据 |
| `principles/05-problem-to-principle-map.md` | §11 | 抖音倍速 → 声明式 one-shot adapter |
| `proposals/unified-design-2026-10-28.md` | §1, §2, §4, §10 | 统一设计总纲、分层、事务、冲突消解 |
| `research/2026-11-01-spectra-douyin-speed-sync-root-cause.md` | §5.1, §6.3, §11 | 抖音倍速根因报告 |
| `proposals/2026-11-01-spectra-douyin-speed-official-adapter.md` | §11 | 抖音倍速 one-shot 官方适配器方案 |
| `proposals/2026-11-01-spectra-media-control-architecture-optimization.md` | §5, §6 | 全架构优化设计（12 项，分批路线） |
| `research/2026-11-01-spectra-douyin-speed-probe-runbook.md` | 全文 | 抖音实机探测执行手册（EPR-028） |

---

## 14. 末决项（来自 owner 文档，非本文新增）

- 音量路径的 Chrome workload 未注册（可观测性已打通，缺 `runtime-performance-policy.json` 采样窗口）。
- Popup 静音路径一条 smoke 未通过（`controller-only mute ACK`）。
- 6 项真实 Chrome 取证不在 CI。
- Options 与 Popup 仍是两套 token（产品视觉决策，非绕过 token）。
- 抖音 one-shot adapter 尚未实机验证（EPR-028 边界），注册表条目未准入；探测脚本、夹具与运行手册已就绪（自证 19/19），待真实标签页执行。
