---
type: explanation
status: draft
audience: contributor
owner: spectra-doc-quality-audit
last_reviewed: 2026-11-09
---

# SPECTRA 文档质量审计（2026-11-09）

> 本文是日期化证据，不是规范。所有结论以当时工作区为准；被指出问题的文件若已修改，以文件为准。
> 本文不替代任何 owner。
>
> **后记（2026-11-09 当日）**：文中 P0/P1 项已修复——数字改为解析自 08 的单一来源、`EPR-002a`
> 改为链接、四份 owner 表合并为 07 §17、§19 归入 §7.5、06 的十个小节补齐编号、§21 补成真门禁、
> §15 补全、证据按 Evidence contract 降级为 `[E-anecdotal]`，并新增 09 故障索引与本仓第一份
> 控制语义决策记录。因此文中引用的 `§14.3` 等编号已整体后移（现为 §14.10），行号也可能漂移；
> 引用时以被引文件为准。
>
> **后记二（同日，P2 收口）**：Q2 已按"聚合而非逐条"的方式落地——正文里可判定的系统级
> 约束聚成 `SCTRL-059..083`，每条带 Anchor 与可执行证明（08 §20.1 的 proof map），而不是
> 新增 241 个不可维护的编号。每篇规范 owner 补了"只在该篇反复出现且易混"的符号表；九篇
> 0 图的规范文档补齐 22 张图。§7 的验收表因此全部成立。

## 0. 审计范围与方法

**精读**（逐行）：`control/01..08` + `control/README.md`（2006 行）、`principles/01`、`principles/05`、`principles/06`、`engineering/README.md`、`research/README.md`、`guide/`（5 篇，自查）。

**结构审阅 + 关键段**：`architecture/runtime.md`（687 行）、`architecture/media-source-admission.md`、`architecture/unification-and-professionalism-audit.md`、`reference/protocols.md`（404 行）、`security/remote-control.md`、`roadmap.md`、`store-listings/*`。

**未逐行读**：`research/` 其余 13 篇（合计约 3000 行）、HALO 全部、`_archive/`、`proposals/` 4 篇。对这些只做规模与头部判断，结论中已标注。

**方法**：四类检查
1. **硬错误**：同一事实的多个数字、坏引用、编号断裂、规则冲突。可脚本化、无争议。
2. **可复核性**：一句话能否被判定为真/假；一条规则能否被定位到代码。
3. **结构性缺失**：该有的东西不存在。
4. **自相违反**：文档是否违反仓库自己写下的标准。

---

## 1. 结论摘要

| # | 问题 | 严重度 | 直接后果 |
| --- | --- | --- | --- |
| H1 | 不变量总数有 3 个不同数字（44/50/58），校验器只覆盖 53 条 | **P0** | release gate 的口径不可信；5 条不变量无任何保护 |
| H2 | `EPR-002a` 与 `05 §11.1` 逐字重复，且对 `speed` 给出相反规则 | **P0** | 按 EPR 实现会把 speed 做成"写完即成功"，正是"按了暂停还在放" |
| H3 | 实现 owner 表在 4 份文档里各写一遍，粒度互不相同 | **P0** | "单一 owner"原则被自己违反；改一处不知道要同步几处 |
| H4 | 章节编号错位：`§19` 插在 `§7` 之后，`§8` 又在其后 | P1 | 无法按编号顺序阅读，交叉引用不可靠 |
| H5 | 06 §14.3 的"实测"违反仓库自己的 Evidence contract | P1 | 唯一一条真站证据不合格，因此"已验证"站不住 |
| Q1 | 400–600 字符的单句，一句含 5–8 个约束 | **P0** | 无法判定是否被满足，等于不可执行的规范 |
| Q2 | 241 条"必须/不得"无编号，只有 58 条有编号 | **P0** | 绝大多数约束不进任何 gate，也不可引用 |
| Q3 | 规范正文里写事故复盘（过去时），与现行规则混排 | P1 | 读者无法区分"现在必须"和"当年错过" |
| Q4 | 中英混排，且同节内切换语言 | P2 | 阅读成本，且翻译漂移风险 |
| Q5 | 函数名当名词用，无职责地图 | P1 | 单"音量色调"有 6 个函数，无从判断关系 |
| Q6 | 空壳章节与覆盖不足（§21 一句、§15 五行） | P1 | 最直观的功能反而没有规范 |
| Q7 | "Executable coverage"实际是测试文件清单 | P1 | 名称承诺了覆盖率，交付的是链接表 |
| M1 | 缺不变量索引（58 条无法速览） | **P0** | 读者必须读完 674 行才知道有哪些规则 |
| M2 | 缺证据等级，虽然 `research/README.md` 已经定义过 | P1 | 规范里的"实测"无法分级 |
| M3 | 缺故障目录（症状 → 根因 → 位置） | **P0** | 3000 行 research 无法被检索 |
| M4 | 缺反向索引（想改 X 去哪） | P1 | 只有"文件→职责"，没有"职责→文件" |
| M5 | `last_reviewed` 无强制复审 | P1 | 04 停在 07-30，内容已错 14 条，无人发现 |
| M6 | 无 ADR 记录控制语义决策 | P2 | "为什么不能那样做"只存在于聊天记录里 |

---

## 2. 硬错误（P0）

### H1. 不变量总数有三个版本，校验器只覆盖 53 条

**证据（五处出处，三个数字）**

| 位置 | 原文 | 数字 |
| --- | --- | --- |
| `control/04-algorithm-matrix.md:29` | `44 static invariants (SCTRL-001..SCTRL-044)` | 44 |
| `control/04-algorithm-matrix.md:40` | `强制 44 invariants + 51 capabilities + 50 algorithms 全部存在` | 44 |
| `docs/roadmap.md:17` | `keep the 51 capability policies, 50 audited source algorithms, and 50 SCTRL invariants synchronized` | 50 |
| `control/README.md:33` | `58 documented invariants: SCTRL-001..SCTRL-058` | 58 |
| `docs/README.md:73` | `58 documented invariants` | 58 |
| `control/08-invariants-and-gates.md` 实际条目 | 001–058 连续无跳号 | **58（真值）** |
| `scripts/verify/check-spectra-control.ts` | 只出现 53 个编号 | **53** |

**未进校验器的 5 条**：`SCTRL-046`、`SCTRL-047`、`SCTRL-048`、`SCTRL-057`、`SCTRL-058`。

**更严重的是 README 的措辞是错的**：

```
the verifier's mandatory-ID inventory covers `001..056`
```

它声称覆盖 `001..056`，实际 `001..056` 里有 3 条没覆盖（046/047/048），而 057/058 根本不在声明范围内。这句话同时**高估**了覆盖范围（说 56 实际 53）并**隐瞒**了尾巴（57/58 无覆盖）。

**后果**：如果有人按 `04` 的 44 条去核对发布门禁，会少检查 14 条。而这 14 条里包含 `SCTRL-045`（写与证明分离）——这正是当前最活跃的行为变更区。

**修法**：把总数从所有文档里删掉，只保留一个来源（verifier 的常量），其余文档改为引用该常量名。数字不能手写。

---

### H2. 同一规则写两处，且对 `speed` 给出相反规则

**证据 A：逐字重复**

`principles/01-state-and-ownership.md:46-49`：

> - `writeState: 'written'` — setter 已执行且元素当前反映请求值。事务可以据此作答。
> - `writeState: 'confirmed'` — 经过事件静默窗与两个渲染边界后值仍然成立。
> - `writeState: 'drifted'` — 页面在我们写入后又恢复了别的值。……
> - `writeState: 'unconfirmed'` — 稳定化未能结束……明确**不是**失败：不报错、不补偿。

`control/05-control-state.md:214-217`：

> - `written`：setter 已执行且元素当前反映请求值。事务据此作答。
> - `confirmed`：经过事件静默窗（`NATIVE_EVENT_QUIET_MS = 64`）与两个渲染边界后值仍成立。
> - `drifted`：页面在我们写入后恢复了别的值。……
> - `unconfirmed`：稳定化未结束……**不是失败**：不报错、不补偿。

**证据 B：适用范围相反**

| 文档 | 原文 | 把 speed 包含进去吗 |
| --- | --- | --- |
| `principles/01:45` | `对 native 字段（volumeBase / mediaMuted / speed），"物理写入"与"稳定证明"是两个不同事实` | **包含** |
| `principles/01:56` | `不适用：Capture/WebAudio 增益、处理器生命周期、跨 100 路由边界` | 不含 speed |
| `control/05:185-186` | `当前仅 optimistic 模式的标准 DOM volumeBase / mediaMuted 可以分开作答；speed 是离散设置，始终在同一事务内等待稳定证明` | **明确排除** |
| `control/07:107` | `DOM speed 等待稳定读回，page-controller speed 等待双证人` | 明确排除 |

**后果**：按 `EPR-002a` 的措辞实现 speed，会在物理写入后立刻回 `written`。这正是 `05:227` 自己写下的失败模式：

> 先答 `written` 会把一次没生效的暂停报告为成功，再靠后续观察翻回，正是「按了暂停却还在放」的观感来源。

也就是说：**原则文档教的做法，正好是被规范文档认定为 bug 的做法。**

**为什么 `docs:check` 没发现**：它只检查 frontmatter、链接、owner 名唯一。它不检查"同一段语义是否出现在两个文件里"。

---

### H3. 实现 owner 表四份并存

| 位置 | 行数 | 组织方式 | 覆盖面 |
| --- | --- | --- | --- |
| `control/01-foundations.md:86-105` | 20 | 按 location | 控制值、执行器、Popup、设置 |
| `control/07-runtime-and-performance.md:81-123` | 43 | 按文件 | 全应用（含 remote、diagnostics、build） |
| `architecture/runtime.md:643-672` | 30 | 按 concern | 运行时、Popup、inventory、artifact |
| `control/README.md:74-79` | 6 | 按文件名 | 5 个文件 + 1 个校验脚本 |

**这不是"多处索引"，是"四份定义"。** 差异举例：

- `native-media-async.ts` 在 `01` 里是"唯一物理异步 setter/readback 原语"，在 `07` 里变成 6 件事的拼接（唯一 ACK + playing/PiP/全屏物理 setter + `confirmStableNativeEvent` + PiP 属性会话所有权 + source cancellation + frame cadence cache），在 `runtime.md` 里**根本没有独立行**。
- `popup-frame.ts` 只在 `07` 出现；`hotkey-target-repository.ts` 只在 `runtime.md` 出现；`media-inventory-runtime.ts` 只在 `07` 出现。

**为什么这是 P0**：仓库的核心治理原则是 `EPR-001`（单一事实源）和 `EPR-006`（一个 `{document, media, field}` 一个写者）。**文档自己违反了它正在强制执行的规则。** 而且结果是：新增一个文件时，你不知道该更新哪张表；删除一个文件时，四张表里可能留下三处幽灵。

---

### H4. 章节编号错位

| 文件 | 篇头声明 | 实际顺序位置 |
| --- | --- | --- |
| 01 | §1–§2 | 1 |
| 02 | §3–§6 | 2 |
| **03** | **§7 + §19** | **3** |
| 04 | §8–§9 | 4 |
| 05 | §10–§12 | 5 |
| 06 | §13–§15 | 6 |
| 07 | §16–§18 | 7 |
| 08 | §20–§21 | 8 |

`§19 User experience` 被塞进 `03`，而 `§8` 在下一篇。顺序读会在第 3 篇读到 §19，然后回到 §8。

同类问题：`06` 里有 4 个二级标题没有编号——`SPA identity and source lifecycle`、`Closing live players and speed inheritance`、`Document replay intent lifetime`、`Executable coverage and limits`。全仓库有 20 处交叉引用指向 `06` 的锚点，其中至少 `#134-closing-live-players-and-speed-inheritance`、`#135-document-replay-intent-lifetime` 这类无法用编号引用。

**成因**：这些文档是从一份大文件按主题拆出来的，编号没有重排。这是重构遗留，不是设计。

**后果**：任何"请看 §13.2"的说法都不可靠，因为读者无法判断 §13.2 在哪一篇。

---

## 3. 写法问题（P0–P2）

### Q1. 单句 400–600 字符，一句含 5–8 个约束（P0）

实测最长的几句：

| 位置 | 字符数 | 这一句里包含了几件事 |
| --- | --- | --- |
| `04a-algorithm-matrix.md:87` | 614 | — |
| `02-strategy-and-routes.md:69` | 546 | 音量边界判定、释放条件、documentOutput 定义、撤销方式、Visualizer 限制、旧字段兼容、失败处理（7 件） |
| `01-foundations.md:19` | 497 | 有效音量语义、控制器优先、boost 概念、Capture 回退、已确认后不重复探测（5 件） |
| `02-strategy-and-routes.md:67` | 485 | 手动路由作用域、key 形状、规则投影、匹配优先级、query/hash 排除、自动检测边界、SPA 刷新、导航约束（8 件） |
| `03-ui-and-boundaries.md:19` | 434 | 颜色不得预测、首读是并发观察、generation 优先、pending 不得冒充、缺字段不清除、颜色语义、手势前瞻、前瞻非投影（8 件） |

**为什么这是 P0 而不是文风问题**：

一条规范要能被判定"是否被满足"，前提是它能被拆成可观察的命题。`03:19` 那一句里，"pending/error 不能冒充稳定结果"和"首份快照缺少处理器字段时不得清除已证明的颜色"是两条独立规则，可能一条满足、一条违反。写成一句后，**验收时只能整体判"看起来对"**。

而且这些句子在流式阅读时不可解析——读者会在第 3 个子句丢失主语，然后靠猜。

**修法**：一句话一个约束；必须在一行内说完的，改成编号列表。`principles/06-ai-authoring-hygiene.md` 就是这么做的（每条：原因/反例/正例/守门），那是全仓唯一可直接执行的文档格式。

---

### Q2. 241 条无编号断言 vs 58 条有编号（P0）

| 文件 | "必须/不得/不能/禁止/严禁"出现次数 |
| --- | --- |
| `05-control-state.md` | 89 |
| `06-media-and-video.md` | 74 |
| `03-ui-and-boundaries.md` | 40 |
| `02-strategy-and-routes.md` | 27 |
| `07-runtime-and-performance.md` | 10 |
| 合计 | **241** |

有编号的只有 58 条（`SCTRL-*`），其中 53 条进静态校验、5 条不进。

**这意味着规范体系有两层，且只有薄的一层是硬的**：

| 层 | 数量 | 可引用 | 可校验 | 可追踪变更 |
| --- | --- | --- | --- | --- |
| SCTRL 编号 | 58 | 是 | 53/58 | 是 |
| 正文散文 | 241 | 否 | 否 | 否 |

`08` 里那条最关键的"SCTRL-054：直播不得写 speed"是硬的；而 `06:281`"播放/暂停由专用 `writePlaybackWithStableAck` 做一次原生写入"这种同等重要的规则，是软的。

**后果**：任何"我们遵守了规范"的说法，只能覆盖 58/299 ≈ 19% 的约束。

**修法不需要新机制**：把 241 条按主题拆成编号条目，挂在现有 58 条后面（`SCTRL-059..`）。`08` 的格式已经证明这条路可行。

---

### Q3. 规范正文里写事故复盘（P1）

`06` 里有三处典型的"过去时叙事"混在现在时规则里：

**`06:458-460`**

> The old implementation lifted the attribute, awaited `requestPictureInPicture()`, and restored it in `finally` — so the window appeared and the browser closed it again in the same task, which then read back as `Picture-in-Picture readback mismatch after the stable boundary`.

**`06:516-518`**

> Writing it anyway produced a `Native volumechange event readback did not acknowledge the requested value`-style mismatch that described the symptom and hid the cause — the player accepted the value and reverted it, and the slider looked broken.

**`06:553-555`**

> What must never happen is replaying it: the row is what an exact-resource reload and a same-document route change restore from, so restoring an observed mute made the next visit start silent.

**这些内容本身极有价值**（它们是根因知识），但放错了位置：

- 规范读者需要的是"现在必须怎样"，一句"`disablePictureInPicture` 在会话期内由扩展持有，会话结束或元素状态清除才归还"就够了。
- 事故经过属于 ADR 或 research。混排的结果是：读者读到第三段时已经分不清这句话是"当年的错"还是"现在的规矩"。

**判断标准很简单**：如果一句话删掉之后，实现者会写出不同的代码，它属于规范；如果删掉之后实现不变、只是不知道为什么，它属于 ADR。

按这个标准，`06` 里至少 40% 的文字应该搬走。

---

### Q4. 中英混排，同节内切换（P2）

| 文件 | 现象 |
| --- | --- |
| `02` | §3 英文表格、§4.1 中文长段、§4.2 中文、§5 中文、§6 中文 |
| `06` | §13.1 中文、§13.2 中英混排表格、§14.1–14.4 **全英文**、§14.5–14.6 **全中文**、§15 中文 |
| `05` | §10 中文叙述、§11.1 中文、§11.2 中文 + 英文表、§12.1 中文列表、§12.2 英文段 + 中文表 |

同一节内切换语言，最大的风险不是阅读体验，是**翻译漂移**：`03:19`（中文）和 `03:75`（中文）都在讲 `resolveVolumeTone`，`05:243`（中文）和 `05:249-253`（中文列表）又讲一遍，而 `08:SCTRL-049`（英文）再讲第四遍。四处措辞不同，读者无法确认是不是同一件事。

**修法**：按文件定语言，规则条目单一语言，术语首次出现时给英文原词。

---

### Q5. 函数名当名词，没有职责地图（P1）

单"音量该显示什么颜色"这一件事，文档里出现 6 个函数名：

`resolveVolumeTone`、`resolveAudioVolumeState`、`resolveVolumePresentation`、`resolveHotkeyVolumeTone`、`resolveSettledVolumeTone`、`refreshHotkeyVolumeTone`

再加 2 个映射函数：`volumeToneToAudioVolumeState`、`audioVolumeStateToVolumeTone`。

`05:245` 用一句话解释了两个映射是互逆，但没有一处解释**这 6 个函数分别在什么时刻被调用、谁调用谁**。读者只能去读代码。

同类还有 badge 链：`projectBadgeFromSnapshot`、`isBadgeProjected`、`admitBadgeProjection`、`claimMediaObservationEpoch`、`scheduleObservationProjection`、`reprojectBadgeForCurrentDocument`、`invalidatePaintedBadge`（7 个，`05:284-306`）。

**修法**：每篇开头一张"本主题的符号表"，三列：符号 / 一句话职责 / 谁调用它。不需要图，表格就够。

---

### Q6. 空壳章节与覆盖不足（P1）

| 位置 | 声明范围 | 实际内容 |
| --- | --- | --- |
| `08 §21` | "Migration and release gate" | **一句话**（`Closure order: ... Enforced by ...`） |
| `06 §15` | "Video effects and screenshot"（Rotate/Mirror/Fill/Filter/Dim/Screenshot 六项） | **5 个 bullet**，共 6 行 |
| `04-algorithm-matrix.md` 全文 | "51 capabilities 完整矩阵" | 41 行，纯索引，且数字过时 |

`§21` 的问题最严重：这是**发布门禁**——决定能不能发版的东西。它只有一句话，没有：判据、例外申请流程、失败处置、回滚条件、谁有权批准。

`§15` 的问题最直观：视频效果是用户唯一能直接看见的功能，规范只有 6 行。没有效果叠加顺序、没有与站点 CSS 冲突的处理、没有 Dim 四块 Overlay 的几何规则、没有截图的分辨率与裁剪边界。

---

### Q7. "Executable coverage"是测试文件清单（P1）

`06:422-440` 的表叫 **Executable coverage and limits**，实际是三列：业务边界 / 可执行规格（文件名链接）。

它回答的是"哪个测试文件管哪块"，不回答：

- 每条 `SCTRL` 由哪个测试覆盖
- 哪些 `SCTRL` **没有**测试
- 每个用例是单测、夹具还是真站（证据等级不同）
- 覆盖率数字

表格下方那句"本节固化媒体控制范围内的业务分支，不宣称全扩展所有逻辑已穷尽验证"是诚实的，但它同时说明标题名不副实。

---

### Q8. 外部标准引用无版本（P2）

| 位置 | 引用 | 缺什么 |
| --- | --- | --- |
| `06:98` | MDN History API | 无访问日期 |
| `06:355` | W3C Media Capture and Streams | 无版本/日期 |
| `06:455` | W3C Picture-in-Picture §3.4 | 无版本/日期 |
| `07:19` | Chrome scripting API | 无版本 |
| `03:65` | "Chrome 138+ 还需要…" | 有版本，但没有来源链接 |

规范引用外部标准，必须带"as of 日期 + 版本"，否则标准一改，就不知道当时的依据是什么。`03:65` 那种带版本的写法是对的，其他几处应该向它看齐。

---

## 4. 缺失（P0–P2）

### M1. 缺不变量索引（P0，最高性价比）

**对比**：

`engineering/README.md` 有 29 条原则，形式是：

```
- **EPR-006**: 1 `{document, media, field}` = 1 writer.
```

一行一条，可扫读，详细定义在别处。**这是正确的 progressive disclosure。**

`control/README.md` 只有 8 行"文件 → 范围"，然后读者必须打开 674 行的 `08` 才能知道 58 条不变量分别是什么。

**后果**：想确认"我这次改动有没有违反某条不变量"，得先读完 674 行英文。实际上没人会这么做，所以不变量在实践中退化成"发布前跑一下脚本"。

**修法**：在 `control/README.md` 加 58 行，每条一句。总成本约 1 小时，收益是全部后续讨论都能用编号说话。

---

### M2. 缺证据等级（P1）——但项目其实定义过

`docs/research/README.md:30-42` 有一段 **Evidence contract**：

> Every current research claim that affects prioritization records:
> - observation date and geographic/product scope;
> - primary source or reproducible dataset;
> - metric definition and sampling method;
> - whether the evidence is current, historical, inferred, or anecdotal;
> - competing explanation and known selection bias;
> - decision that the evidence supports;
> - revalidation trigger.

**这份契约写得很专业。问题是没有任何一份规范文档引用它。**

`06:541-544` 是全仓唯一一条带实测的规范文本：

> Measured on `live.douyin.com` after a real gesture: `speed` → `{"phase":"error",...}` with `playbackRate` still `1`; `volume 40` → `applied`, page `volume 0.4, muted false`; the same tab's VOD fixture still reports `live: false` and applies `1.5x`.

按仓库自己的 Evidence contract，这条记录**不合格**：

| 契约要求 | 该段是否记录 |
| --- | --- |
| observation date | 无 |
| geographic scope | 无 |
| sampling method | 无（"after a real gesture"不是方法） |
| current / historical / inferred / anecdotal | 无标注 |
| competing explanation | 无 |
| revalidation trigger | 无 |

**这是本次审计里最值得说的一条**：问题不是"没有标准"，而是"标准存在却不被规范层引用"。修法不是新写一份证据分级，而是让 `control/*` 引用 `research/README.md#evidence-contract`，并在需要标注处写 `[E-current]` / `[E-inferred]` / `[E-anecdotal]`。

---

### M3. 缺故障目录（P0）

`docs/research/` 有 14 篇，合计约 3000 行（`2026-11-05` 单篇 999 行）。它们记录了每一次事故的完整过程，但**没有任何一份"症状 → 根因 → 代码位置"的索引**。

最近三轮对话里反复出现同一个模式：用户报一个症状 → 重新读 999 行 → 得出"根因在 X" → 下一次换个症状再来一遍。

**这正是 `2026-10-26-spectra-architecture-audit.md:4-8` 自己写下的教训**：

> 它们原先存放在仓库根目录的 `artifacts/`，被 `.gitignore` 排除，也不在权威体系内——任何按 `AGENTS.md` 入口读取仓库的会话都读不到它们，于是每次都要重新审计一遍，产出第二套平行的分析。

教训被记录下来了，但**索引没有建**。所以同样的事还在发生，只是从"文档被 gitignore"变成"文档在但检索不到"。

**该有的东西**：一张表，四列

| 症状（用户看到什么） | 根因（哪个判断错了） | 现行规则 | 证据文档 |

至少覆盖：`stale-media-source` 频繁出现、视频→直播后失控、站点 UI 不同步、按暂停还在放、角标不刷新、音量条不跟手、Popup 首帧空白、PiP 打开即关。

---

### M4. 缺反向索引（P1）

`07 §17` 是"文件 → 职责"。缺的是"我想做 X → 改哪几个文件"。

实例：用户在 `guide` 里问"为什么站点 UI 不同步"，正确回答需要同时指向 `page-media-bridge.ts`（能力探测）、`site-adapter-registry.ts`（声明行）、`05 §11.2`（色调）、`06 §14.3`（直播边界）四处。没有索引，这个回答只能靠人记住。

---

### M5. `last_reviewed` 只是装饰（P1）

`04-algorithm-matrix.md` 的 `last_reviewed: 2026-07-30`。它的内容已经错了 14 条不变量，错了 3 个月，`docs:check` 每天跑都没发现——因为校验器只看日期格式，不看内容是否与别处一致。

**修法**：数字类断言不手写（见 H1）；`last_reviewed` 超过 N 天转 `warn`；跨文档数字一致性加一条可执行检查。

---

### M6. 无 ADR（P2）

`docs/decisions/` 只有 3 篇，全部是"复用/依赖"决策，没有一条**控制语义决策**。

而这些决策在对话里反复被重新讨论：
- 为什么 `sourceRevision` 变化不算换对象
- 为什么 speed 不能 split ACK
- 为什么 `>100%` 不允许预测站点 UI
- 为什么页面内快捷键拿不到 Capture 准入
- 为什么不用选择器定位元素

每一条都有明确理由，但都不在 `decisions/` 里。它们散落在 `06` 的事故叙事、`08` 的不变量、和聊天记录里。

---

## 5. 值得保留的正面样板

审计不能只有否定。这三处是全仓标准最高的地方，应该被复制而不是被重写：

### 5.1 `principles/06-ai-authoring-hygiene.md`（全仓唯一"可执行文档"）

格式：

```
- **1.1 `chrome.runtime.onMessage` 必须 `return true`**:
  - *原因*: MV3 SW 异步 `sendResponse` 需保持通道打开。
  - *反例*: <代码>
  - *正例*: <代码>
  - *守门*: `ai-pitfall-detector.ts` (`onmessage-async-no-return`)
```

四个要素齐全：**规则 / 为什么 / 错的样子 / 谁拦你**。而且末尾有汇总表（规则 → 守门 → 级别）。

`control/*` 如果按这个格式重写，Q1（长句）和 Q2（无编号）会同时消失。

### 5.2 `engineering/README.md`（正确的索引粒度）

29 条原则，每条一行，详细定义在分片文件。索引只做导航，不复制规则。这正好是 `control/README.md` 缺的（M1）。

### 5.3 `control/04-algorithm-matrix.md` 的"只索引不持内容"原则

原文：

> 引用规则: 此文件**仅**做章节映射,不再持有任何规范内容。

**原则是对的，执行是错的**（数字过时、多一层跳转）。但方向值得保留：一个主题一个 owner，索引层不复制。

---

## 6. 修复顺序

按"投入产出比"排序，不是按严重度。

### P0（半天，全部是删改数字和重复）

1. **删除所有手写的不变量总数**，包括 `04:29`、`04:40`、`roadmap:17`、`README:33`、`docs/README:73`。改成引用 verifier 的常量。
2. **修正 `control/README.md:33` 的错误措辞**（"covers 001..056" → 实际 53 条）。
3. **删除 `principles/01:44-56`（EPR-002a）**，改为一行链接到 `05 §11.1`。这是唯一一处"规则冲突"，删掉比改快。
4. **把 4 份 owner 表合并成 1 份**（保留 `07 §17` 的 43 行版本，其余三处改为链接）。

### P1（2 天）

5. **`control/README.md` 加 58 行不变量索引**（M1）。
6. **`06` 的 4 个无编号标题补编号**，`§19` 从 `03` 移回 `08` 之前（H4）。
7. **`06:541` 那段实测补 Evidence contract 六项**，或降级为 `[E-anecdotal]`（M2）。
8. **`08 §21` 补成完整门禁**：判据、例外、失败处置（Q6）。

### P2（1 周）

9. **建故障目录**（M3），先做 8 条高频症状。
10. **把 241 条正文断言收编成 `SCTRL-059..`**（Q2）。这一步最贵，但做完之后 19% 变 100%。
11. **`06` 的事故叙事搬进 `docs/decisions/`**（M6、Q3）。
12. **每篇加符号表**（Q5）。

### 不做

- 不要新增"文档质量分"或"完整度百分比"。这类指标会被优化成数字游戏。
- 不要为 241 条断言新造一套编号体系。`SCTRL` 已经够用。
- 不要把 `guide/` 的内容合并进 `control/`。教程和规范分开是对的。

---

## 7. 验收

修完之后，下面四条必须同时成立：

| 检查 | 期望 |
| --- | --- |
| `grep -rn "44 static invariants\|50 SCTRL\|covers .001..056"` | 零结果 |
| `grep -c "^## EPR-002a"` | 零结果（已并入 05） |
| 每篇规范的最长单句 | ≤ 200 字符 |
| `08` 的每条不变量 | 有编号、有 Anchor、有对应测试或明确标注"无测试" |

---

## 8. 本次审计的局限

1. **没有逐行读 3000 行 research**，对它们的判断基于清单、头部和交叉引用。
2. **没有验证外部链接是否可访问**，只指出引用缺版本。
3. **没有跑完整测试套件**，`SCTRL-046/047/048` 是否被测试覆盖只是"不在 verifier 里"，不等于"没有测试"。
4. **`guide/` 是自查**：它同样存在"断言未标注证据等级"的问题（例如 `02-spectra-map.md §8` 的四步链路分析基于 11-08 的代码阅读，未在本轮复验）。这一条应当按 M2 的同一标准处理。
5. 本报告本身是 `draft`，且按 Evidence contract，它记录的 observation date 是 2026-11-09、范围是当前工作区（含未提交改动）、方法是静态阅读 + 脚本核对，没有运行产品。
