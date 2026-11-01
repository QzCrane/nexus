# 抖音倍速 one-shot 官方适配器 — 系统化架构方案

- **日期**：2026-11-01
- **状态**：**Stage 1 + Stage 2 已实现**（本文档描述的注册表、桥内接入、`declared-official` 路由与投影级 drift 已落地并全绿）。抖音条目仍为 `candidate`：机制可用，但徽标选择器未经真实标签页确认，`verified` 需按 §8 闸门补证。
- **实现偏离**：§12 记录两处与初版设计不同的决定（投影是**证人**而非闸门；投影实现为文本扫描而非 React 内部读取）及其理由。
- **关联报告**：`research/2026-11-01-spectra-douyin-speed-sync-root-cause.md`
- **关联原则**：EPR-007（Native-First 策略）、EPR-002（Desired/Actual/ACK/Snapshot/UI 分层）、EPR-028（Public Copy Truthfulness，结论须以已验证能力为界）、`05-problem-to-principle-map.md:24`（抖音倍速 → 只允许已声明的 one-shot official adapter）。
- **关联不变式**：SCTRL-004（无通用 MAIN monkey-patch，仅 allowlisted 文档注入）、SCTRL-027（one-shot ACK）、SCTRL-046（newer write cancels proof）。

---

## 0. 文档目的与适用边界

本方案解决一个已确证的根因：通用 page-native 发现无法定位抖音 `speed` 控制器，导致写入降级到 `dom-native`，而抖音倍速标签由 React state 驱动、不读 `element.playbackRate`，造成单向 UI 不同步。**附加修复目标**：当前诊断子系统（写入确认、事件观察、per-site ledger）全部只读 `element.playbackRate`，对该类"UI 与媒体元素属性分叉"的 bug 结构性失明——方案须一并修复这一可观测性缺口。

本方案**不**依赖通用发现、不做通用播放器爬虫、不引入任何持久化全局监听器；仅以**声明式、allowlisted、per-site** 的方式补齐抖音 speed 这一唯一已知失效组合。

---

## 1. 问题陈述与设计目标

### 1.1 问题
- 正向：插件写倍速 → 抖音 UI 标签不同步（真实速率已变）。
- 反向：抖音 UI 改倍速 → 插件同步正常。
- 系统无告警：ledger 永远 `confirmed`，无自愈/降级信号。

### 1.2 设计目标
1. **UI 回流**：抖音 speed 写入必须驱动其 React state / UI 标签，而不仅是 `element.playbackRate`。
2. **可验证 ACK**：写入成功的前提是读回抖音**真实 UI 投影**（官方 getter/readback），而非裸 DOM 属性。
3. **安全可回滚**：adapter 不可用或回读失配时，透明回退到 `dom-native`；不写全局规则、不残留监听器。
4. **可观测**：引入"UI 投影真值源"后，若真实抖音 UI 仍不同步，ledger 须记 `drifted` 并触发降级——消除诊断失明。
5. **可扩展**：同一框架以声明式注册表承载其它站点的同类适配器，每站点独立 allowlist、独立验证。

### 1.3 非目标
- 不泛化通用发现逻辑去"猜"任意站点（那会破坏 EPR-028 的能力边界与 SCTRL-004）。
- 不重引入已退役的 `youtube-adapter.ts` 式硬编码 MAIN 文件；改为数据驱动、由现有 allowlisted 桥消费。
- 不在本次解决 volume/mute 等其它字段（其当前行为未被报告为异常）。

---

## 2. 架构定位

### 2.1 在 EPR-007 策略链中的位置
当前：`observe → exact DOM/Chrome native → one-shot 官方 API → 可逆增强 → unsupported`（`docs/proposals/unified-design-2026-10-28.md:40`）。

本方案在 `speed` 字段上把"one-shot 官方 API"具体化为**声明式 per-site adapter**，且仅当 host 命中 allowlist 时启用。对于未声明的站点，`speed` 仍按现有 `page-native → dom-native` 路由（不变）。

```
speed writer 选取（抖音 host 命中 allowlist 时）：
  declared-official  ──成功──▶ 写抖音 UI setter + 官方 getter 读回 UI 投影
        │ 失败/未命中
        ▼
  page-native (通用发现) ──失败──▶ dom-native (element.playbackRate)
```

### 2.2 与 page-media V2 桥的关系（关键：满足 SCTRL-004）
**不新增任何 MAIN 世界脚本**。现有 `injector/page-media-bridge.ts` 是唯一 allowlisted 的 `document_start` MAIN 注入（`04b-source-algorithms.md:75`）。本方案将抖音专属知识表达为**数据**，由该桥的 `capabilityFor` / `findCapability` 在命中 host 时查询，而非另起一个注入文件。

具体做法：在现有 MAIN 桥内增加一个**声明式 per-site 覆盖表**（见 §3），仅当 `location.hostname` 命中某个 allowlisted 条目时，用该条目的方法名/关联键/UI 投影读取器**替代或补充**通用启发式。这与 SCTRL-004"无通用 MAIN monkey-patch，仅 allowlisted 桥"一致——扩展行为仍只在既有的 allowlisted 桥内发生。

### 2.3 与退役 `youtube-adapter.ts` 的区别
| 维度 | 退役 youtube-adapter | 本方案 |
|---|---|---|
| 形态 | 硬编码 MAIN 文件，`hybrid-state-native` | 数据驱动的 allowlist 表，由现有桥消费 |
| 注册 | 隐式（文件即能力） | 显式声明、代码评审、EPR-028 验证后才加入 |
| 范围 | 单站点硬编码 | 同一框架承载多站点，每站点独立条目 |
| 验证 | 无强制 UI 投影回读 | 写入须以官方 UI 投影 getter 成功为 ACK 前提 |

### 2.4 一个可行性修正：不新增 `ControlStrategy` 枚举值

初版把 `declared-official` 写成一个新的写入层。落地前必须修正一处：**`ControlStrategy` 是封闭的 wire 枚举，且承载位序**。

证据（`packages/contracts/src/control.contracts.ts`）：

- `CONTROL_STRATEGIES` 与 `CONTROL_STRATEGY_SELECTION_ORDER` 决定 wire 取值与执行顺序；
- `CONTROL_STRATEGY_RULES` 为每个策略给出六维元组（class / writer / interception / evidence / mainWorld / cost），并有契约测试要求键集完全一致；
- `FIELD_STRATEGIES.speed` 现为 `['page-native','dom-native']`；
- `ControlFieldState.strategy` 直接把这个枚举暴露给 UI 与 ACK。

新增一个枚举值会同时改动：wire 编号、位序、规则表、契约测试、UI 分组、以及 `restore-page-settings` 等按策略分派的路径。对"只修一个站点的一个字段"而言，这是不成比例的协议变更。

**修正后的设计**：

- **wire 层不变**：`strategy` 仍报 `page-native`（因为调用站点自己的 setter，语义上就是 page-native）；
- **内部路由增加一档**：把执行器的 `RestorableMediaWriter`（`native-media-executor.ts:84`，现为 `'page-native' | 'dom-native'`）扩为 `'declared-official' | 'page-native' | 'dom-native'`，仅用于选择写入与证据策略，不上 wire；
- **证据策略挂在路由上**，不挂在枚举上：`declared-official` 要求 UI 投影回读，其余路由保持现状。

这样既拿到"声明优先"的能力，又不触发协议与 UI 的连锁改动。§4、§10 已按此修正。


---

## 3. 适配器契约与声明式注册表

### 3.1 注册表形态（allowlisted 数据，非自动发现）

落地于 `src/shared/site-adapter-registry.ts`——**纯数据模块，无 DOM、无副作用**，由 MAIN 桥与 ISOLATED 执行器各自打包引用。因此它不新增注入文件、不改协议、不改 wire 枚举。

```ts
type SiteAdapterStatus = 'candidate' | 'verified' | 'disabled';

interface SiteAdapterEntry {
  id: string;                          // 'douyin-speed'
  hosts: string[];                     // 'douyin.com' 覆盖全部子域；'.' 边界强制
  field: SpectraPageMediaField;        // 当前仅 speed
  revision: number;                    // 声明形态变更即自增，进入证据
  status: SiteAdapterStatus;           // candidate 未过闸门 / verified 已过 / disabled 撤回
  discovery: {
    setterNames: string[];             // 只列通用探测**不认识**的名字
    getterNames: string[];
    accessorNames: string[];
    associationKeys: string[];
    maxAncestorDepth: number;          // 可放宽，受硬上限夹紧
    maxAttachedProperties: number;
    maxPrototypeDepth: number;
    followReactFiber: boolean;         // 是否走 __reactFiber$* / __reactProps$* 找实例
  };
  projection: {                        // null ⇒ 只能回答 probe，永远不能写
    kind: 'text';
    scopeSelectors: string[];          // 先按选择器定位，再回落到元素祖先
    patterns: string[];                // 每个正则恰好一个捕获组
    tolerance: number;                 // 徽标进位容差（"1.0x" vs 1.04）
  } | null;
}
```

两条硬规则由注册表测试强制：

1. **声明名必须是通用词表的补充，不能是重复。** 重复的 `setPlaybackRate` 不产生优先级，条目会输给更近的通用控制器，而评审时看不出来。为此通用词表搬到 `GENERIC_PAGE_MEDIA_VOCABULARY` 并加了重叠断言——这条规则是端到端测试里的"诱饵"用例逼出来的（§8.4）。
2. **没有 `projection` 的条目只能回答 `probe`，永远不能承载写入。** 没有 UI 证人的写入，正是本方案要终结的形态。

抖音条目随代码发布，`status: 'candidate'`：初次命中即生效，但每次写入都以徽标为证人，模型不符即被判 drift。这让机制在实机验证之前就是"活的"，同时不谎称已验证。

### 3.2 运行期集成点

`injector/page-media-bridge.ts` 在模块加载时按 `location.hostname` 为每个字段解析一次条目（`ADAPTERS`），随后：

- `capabilityFor` 先走条目声明的 setter/getter/accessor 名，再回落到通用名；
- `controllerAssociation` 先走条目声明的关联键，再回落通用键；
- `collectControllerCandidates` 用条目夹紧后的边界遍历，并按 `followReactFiber` 额外走 React 挂载记录；
- 候选排序把 **declared 优先**置于关联等级之前——条目存在的理由就是通用排序在这里选错了对象；
- `findCapability` 返回 `{ capability, adapterId }`，`adapterId` 仅在**声明知识命中**时非 null。

`adapterId` 是归因的关键：它让执行器能区分"桥用站点知识找到了"与"桥用通用启发式找到了"，而不用猜。

### 3.3 官方 getter/readback 的硬约束（已修正为证人语义）

初版要求"UI 投影回读 == desired 作为 ACK 前提"。实现后按 §12.1 改为：

- ACK 前提仍是**控制器 getter**（官方 readback），由桥在写入后同步比对，不符即回滚；
- **UI 投影是证人**：桥在同一次事务里返回它，但不用它否决写入；
- 投影的最终裁决放在事务之后（`NativeWriteConfirmationRegistry.auditProjection`），结果写入 per-site ledger。

理由是 React 的批量渲染：setter 返回后徽标可能晚一两帧，同步否决会打回站点本来就要兑现的写入；而速率已经正确，回滚反而违背用户意图。真相仍然被记录——只是记在 ledger 里而不是错误里。

## 4. 写入与回滚流程

### 4.1 writer 识别

`readRestorableMediaFieldWithWriter` / `readRestorableMediaFieldForWrite` 以**桥自报的 `adapterId`** 决定 writer，而不是以 host 是否命中条目决定——否则一个"命中条目但通用路径命中"的读取会被误标为声明式。优先级：

```
declared-official（桥回传 adapterId）
  → page-native（桥找到通用控制器）
  → dom-native（element.playbackRate）
```

如 §2.4 所述，`declared-official` 只存在于内部 `RestorableMediaWriter` 联合类型，**不进入 wire 的 `ControlStrategy`**。`wireStrategy()` 把三档折回两档，ACK 对外仍报 `strategy: 'page-native'`；`observationStrategy()` 同理处理更窄的观察枚举。

三档路由的差别在**证据策略**：

| 路由 | 写入通道 | ACK 读回 | 事后证据 |
|---|---|---|---|
| `declared-official` | 条目声明的 setter（经桥） | 控制器 getter（桥内同步校验 + 回滚） | 徽标投影 → ledger |
| `page-native` | 发现的成对 getter/setter | 控制器 getter | 无（无投影声明） |
| `dom-native` | `element.playbackRate` | 事件 + DOM 稳定读回 | 既有 split-ack 确认 |

### 4.2 事务内写入（适配器路径）

```
writeRestorableMediaField(element, 'speed', desired, 'declared-official')
  → writePageMediaField → 桥 → 条目的 setter(desired)
  → 桥内 capability.read() 比对 desired；不符 → 回滚 + error
  → stablePageReadback(() => 桥读控制器 getter)   // 64ms 静默窗 + 两帧
  → 事务以 strategy: 'page-native' 应答
  → auditDeclaredProjection(...)                   // 事务之后，detached
```

投影审计由 `NativeWriteConfirmationRegistry.auditProjection` 承担：300ms 预算、40ms 间隔轮询，命中即 `confirmed`，读得到但不符即 `drifted`，读不到即 `unconfirmed`。它从不抛错、从不回滚——因为速率已经对了。

### 4.3 回滚与降级
- adapter `set` 抛错或 UI 投影回读失配 → executor 回滚到 `dom-native` 基线（复用现有 `pageCandidateRestoredBaseline` 思路，`:415-441`），并将本次 outcome 记为 `unconfirmed`（非 `confirmed`/`drifted`）。
- 一旦 adapter 在连续 `window` 次内失败 ≥ `driftLimit`，ledger 可降级该 host 的 adapter 启用（软禁用），回退到通用 `page-native → dom-native`，避免反复失败。

### 4.4 与现有 pending 守卫的兼容
正向写后 `ratechange` 仍会被 pending 守卫抑制一次观察；但 adapter 路径的 ACK 已基于 UI 投影，故守卫仅影响"二次 DOM 观察"，不影响 UI 同步正确性。守卫窗口结束后 `reconcileExpiredPending` 复读 DOM——Stage 2 建议**额外复读 UI 投影**，使后续观察也能覆盖 UI 真值（见 §5.2）。

### 4.5 落地形态：两阶段一次性完成，变更面比预估更窄

初版设想分三阶段。实现后 Stage 1 与 Stage 2 一次落地，因为真正的耦合点只有一个：**谁来决定 `writer`**。一旦改为"由桥自报 `adapterId`"，注册表、路由与证据三层就自然串起来了。

实际改动面：

| 层 | 文件 | 内容 |
|---|---|---|
| 数据 | `src/shared/site-adapter-registry.ts`（新增） | 类型、抖音条目、主机匹配、边界夹紧、通用词表 |
| 协议 | `src/shared/page-media-bridge.ts` | 结果增加可选 `adapterId` / `projection` |
| MAIN | `src/content/injector/page-media-bridge.ts` | 声明名/键优先、React fiber、投影读取、`adapterId` 归因 |
| ISOLATED 派发 | `src/content/logic/page-media-bridge.ts` | 共享 `dispatch`，新增 `readPageMediaEvidence` / `probePageMediaDetail` |
| 执行器 | `src/content/logic/native-media-executor.ts` | 第三档 writer、`wireStrategy`、按 `adapterId` 归因、投影审计入口 |
| 证据 | `src/content/logic/native-write-confirmation.ts` | `auditProjection` + 投影级 drift |

**没有**新增 MAIN 注入文件、没有新增 wire 枚举值、没有改动 `ControlStrategy` 规则表——这三条是 §6 不变式的硬约束。

---

## 5. 诊断可观测性修复（消除失明，关键架构贡献）

### 5.1 失明的根因
`native-write-confirmation.ts:readActual` 与 `handleMediaEvent` 的所有读回都基于 `element.playbackRate`。对"UI 由 React state 驱动"的站点，DOM 属性与 UI 投影分叉，而系统只测 DOM，于是永远 `confirmed`。

### 5.2 落地：投影作为独立证人通道

1. **桥内**：`projectionFor()` 在写入/读取的同一事务里返回徽标数值。HB 徽标读取范围先按 `scopeSelectors`，再回落到媒体元素的合成祖先链（≤24 层），文本节点预算 4096。找不到就是 `null`——**绝不当成一致**。
2. **执行器**：仅当本轮 writer 为 `declared-official` 时，事务结束后把 `auditDeclaredProjection` 交给确认注册表。
3. **确认注册表**：`auditProjection` 轮询投影至 300ms 上限，随后 `recordNativeWriteOutcome(siteKey, 'confirmed' | 'drifted' | 'unconfirmed')`。读取器抛错记 `unconfirmed`，不降级站点——坏证人不是坏写入。
4. **ledger 语义不变**：`driftLimit` 仍是 2；两个真正的 drift 就足以把站点降到 `verified`，触发全窗口 ACK。系统首次对"UI 不同步"具备可观测与自愈信号。

这一层不依赖抖音：任何声明了 `projection` 的站点都自动获得同一条证人通道。

### 5.3 收益
- 抖音真不同步时，ledger 记 `drifted` → 站点降 `verified`/软禁用 adapter → 回退通用路径并告警。
- 未来任何"UI 与 DOM 分叉"的站点都可复用同一 UI 投影机制，不再失明。

---

## 6. 安全与不变式

- **SCTRL-004**：不新增通用 MAIN 注入；抖音知识以数据形式在既有 allowlisted 桥内消费。
- **SCTRL-027**：adapter 写入为 one-shot；拒绝/回滚恢复页面基线（复用现有桥的 rollback 逻辑，`injector/page-media-bridge.ts:324-347`）。
- **SCTRL-046**：newer write cancels proof——复用 `NativeWriteConfirmationRegistry` 的"每字段至多一个在途证明、新写取消旧证明"（`:76, :92-95`）语义，adapter 路径不变。
- **无持久监听器**：adapter 不安装 MutationObserver / 长驻事件监听；仅在一次同步事务的 bounded 窗口内读回（沿用 `writeWithStableEventAck` / `confirmStableNativeEvent` 的事件-静默窗口，`native-media-async.ts:140, :207`）。
- **能力边界**：未实机验证（§8）前，抖音条目不进入注册表；即便进入，失败也透明回退，不破坏现有功能。

---

## 7. 扩展到其它站点

注册表框架天然支持多站点：每站点一条 `SiteAdapterEntry`，各自声明方法名/关联键/UI 投影/边界。通用发现（`page-native`）继续作为未声明站点的第一手段；声明式 adapter 仅作为"通用发现失败的已知站点"的精确补充。这与 `01-foundations.md:36` 的 "Site one-shot allowlisted official API" 节点完全对齐。

建议的准入门槛（任一即可申请条目）：
- 该站点被报告存在"UI 与 DOM 分叉"的同类 bug；且
- 实机探测（§8 流程）确认其 UI 驱动 setter 与投影读取路径；且
- 代码评审确认条目不破坏 SCTRL 不变式。

---

## 8. 实测验证计划（EPR-028，落地前必做）

§8 已从"计划"升级为"可执行件"，产物在 `apps/extension-spectra/tools/probes/`：

| 文件 | 作用 |
|---|---|
| `douyin-speed-probe.js` | 零依赖探测脚本，粘贴到目标标签页 Console 即可 |
| `fixtures/douyin-like-player.html` | 仿抖音夹具：状态驱动标签 + 四类白名单缺口 |
| `verify-probe.ts` | 自证脚本：加载真实 `dist/content-page-media-bridge.js` 跑 19 项断言 |

完整操作步骤、判定表、证据模板见运行手册：`research/2026-11-01-spectra-douyin-speed-probe-runbook.md`。

### 8.1 探测的真实分层

脚本不是"打印一堆对象"，而是按 T0→T3 逐层把假设钉死：

| 层 | 断言 | 失败意味着 |
|---|---|---|
| T0 | 用真实桥的 `probe` 协议问 `speed`，应返回 `supported:false` | 若为 `true`，根因结论需修正（桥其实看得见） |
| T1 | 存在 speed 控制器，但被 `setter-name` / `getter-name` / `association-key` / `property-index` / `ancestor-depth` 至少一条拒绝 | 若 `nearMiss=0`，控制器不可达（闭包/fiber/iframe），走 §9 开放问题 |
| T2 | 倍速标签可定位，且能在 React fiber 链中找到 speed 相关 props | 若找不到，`uiProjection` 只能退回 `dom-label`，或以文本正则兜底 |
| T3 | 存在一个 setter，使"真实速率"与"标签"同时变化；同时 DOM 直写只改速率不改标签 | 若 DOM 直写也能改标签，说明该站点 UI 读 DOM，本方案不适用 |

### 8.2 准入闸门（全部满足才写注册表）

1. T0 连续 3 次刷新均 `supported:false`（排除时序偶然）；
2. T1 至少一条拒绝原因可归因到具体控制器，并记录其 `associationKey` / `propertyIndex` / `ancestorDepth`；
3. T2 找到可稳定解析的投影来源，且 T3 中随标签同步变化；
4. T3 找到 `changedRate && changedLabel` 的 setter（或明确记录"只改 UI 状态、需双写"）；
5. `allRestored:true`（脚本能还原），若为 `false` 须在证据中说明并人工恢复；
6. 证据 JSON 落盘 `research/evidence/`，附人工观察（页面形态、标签样式、手动改速是否即时更新）。

### 8.3 自证结果（脚本可信度边界）

`bun tools/probes/verify-probe.ts` → `19/19 checks passed`。关键两项：

```
PASS  dom-native control moves rate but not label
PASS  state-driven setter moves both
```

这证明脚本能在一个"已知形状"的页面上正确区分"只改速率"与"同时改 UI"。它**不**证明抖音就是这个形状——那只能由 §8.1 的实机运行回答。这条边界本身就是 EPR-028 的要求。

### 8.4 声明式适配器的端到端自证

`bun tools/probes/verify-declared-adapter.ts` → `20/20 checks passed`。它在伪抖音域名（`https://www.douyin.com/video/1`，请求拦截返回夹具）下加载**真实构建产物** `dist/content-page-media-bridge.js`，因此测的是发布代码，不是复制品。

夹具刻意放了一个**诱饵**：一个用通用名（`setPlaybackRate`）与通用键（`video`）持有媒体元素的控制器，且比真控制器更靠近 video。通用发现的排序会选它。最关键的三条：

```
PASS  the decoy setter is never used  (decoyWrites=0)
PASS  the badge follows  (badge=1.5x)
PASS  stale badge is reported as-is, not as agreement  (projection=1)
```

第一条 + 第二条合起来是"声明式知识压过更近的通用错误候选"的直接证据；第三条是"陈旧徽标不会被谎报为一致"的证据。另有两条控制组：无控制器页面仍 `supported:false`；无条目的主机上通用发现照常工作但**没有**投影通道与 `adapterId`。

第一次跑这个验证时 13/17 通过——失败的三条暴露了真实缺陷：注册表把通用名重复列进声明名，导致诱饵也被判为 declared，排序退化回距离。修复后 20/20。这条经验被固化成注册表测试（§3.1 规则 1）。



---

## 9. 风险与开放问题

- **抖音前端重构风险**：抖音可能随时改名方法/改结构，使声明式条目失效。缓解：ledger 漂移检测（§5.2）会在失效时自动降级并告警；条目须随抖音迭代复审。
- **React fiber 内存读取的脆弱性**：经 fiber 读 state 依赖 React 内部字段名（如 `memoizedState`/`stateNode`），跨 React 版本可能变。缓解：`uiProjection.kind='dom-label'` 作为更稳的备选（读取标签文本），优先于 fiber 内存读取；二者皆失败则回退。
- **国际化域名**：抖音存在多域名/地区版，注册表须覆盖实际 host 集合（验证阶段枚举）。
- **是否值得为单站点建框架**：权衡是"只给抖音写特例"还是"建通用注册表"。本方案选后者，因其边际成本低（数据表）且能承载未来同类站点，符合 `01-foundations.md:36` 的既定架构节点。
- **UI 投影读回的性能**：每次 speed 写多一次 UI 投影解析，但仍在 bounded 窗口内（沿用现有稳定读回），不影响主路径延迟。

---

## 10. 实施状态对照

**Stage 1（注册表 + 桥）— 已完成**

| # | 项 | 状态 | 落点 |
|---|---|---|---|
| 1 | `SiteAdapterEntry` + 解析器 + 边界夹紧 | ✅ | `src/shared/site-adapter-registry.ts` |
| 2 | 桥内声明名/键/边界/React fiber + `adapterId` | ✅ | `injector/page-media-bridge.ts` |
| 3 | 通用词表上提为共享常量（使重叠可测） | ✅ | `GENERIC_PAGE_MEDIA_VOCABULARY` |

**Stage 2（诊断增强）— 已完成**

| # | 项 | 状态 | 落点 |
|---|---|---|---|
| 4 | `declared-official` 内部路由 + `wireStrategy` 折返 | ✅ | `native-media-executor.ts` |
| 5 | 投影读取器（text 扫描，作用域 + 祖先回落） | ✅ | `injector/page-media-bridge.ts` |
| 6 | `auditProjection` → 投影级 drift → ledger 降级 | ✅ | `native-write-confirmation.ts` |
| 7 | 投影审计不参与 ACK、不回滚（§12.1） | ✅ | 同上 |

**取证与护栏 — 已完成**

| # | 项 | 状态 | 落点 |
|---|---|---|---|
| 8 | 注册表 schema / 主机边界 / 词表重叠测试（9 项） | ✅ | `test/site-adapter-registry.spec.ts` |
| 9 | divergence 矩阵：徽标跟随/滞后/连续滞后降级/无条目不审计（4 项） | ✅ | `test/page-media-declared-adapter.spec.ts` |
| 10 | 真实构建产物端到端：诱饵压过、徽标跟随、陈旧不谎报（20 项） | ✅ | `tools/probes/verify-declared-adapter.ts` |

**未完成（EPR-028 边界，不做即不应声称）**

| # | 项 | 缺口 |
|---|---|---|
| 11 | 真实抖音标签页跑通 §8.2 六步闸门 | 未执行；徽标选择器与 `setSpeed` 命名仍是静态推断 |
| 12 | 条目升为 `verified`、写入证据到 `docs/research/evidence/` | 依赖 11 |
| 13 | `native-write-policy` 的 adapter 软禁用阈值按实测校准 | 依赖 11 |

> 顺序约束（保留）：第 4 步必须连同第 9 步的 divergence 测试一起提交，否则"投影证据"只会在抖音上被验证，缺少回归护栏。本次一并提交，124 个测试文件全绿。

---

## 12. 实现偏离与理由

### 12.1 投影是证人，不是闸门

初版（§3.3、§4.5）要求"UI 投影回读 == desired 才 ACK"。实现时改掉了，原因有三：

1. **React 的渲染是异步的。** `setSpeed` 返回时组件 state 可能还没提交，同步读徽标必然读旧值。以它为闸门会把站点本来就要兑现的写入判失败。
2. **失败语义会更糟。** 一旦判失败，执行器会回滚基线——用户点 1.5 倍，速率变回 1.0，只因为徽标晚了一帧。这比"速率对了但标签旧"更伤。
3. **真相不必靠错误来记。** 投影的裁决放进独立审计写 ledger，既不打断用户动作，也不丢失观测：连续两次真 drift 仍会把站点降级。

于是分工是：**桥负责"写进去没有"（同步、可回滚），审计负责"UI 跟上没有"（异步、只记录）**。两条通道各自诚实。

### 12.2 投影实现为文本扫描，不是 React 内部读取

初版设想了 `kind: 'react-state'`：经 fiber 读组件 state。实现时放弃：

- React 内部结构随版本变化，`memoizedState` 的链表形态与 hooks 顺序都不是契约；一条 2026 年写的读取器在 2027 年可能读到别的字段而且**不报错**。
- 徽标文本是被用户实际看到的那个东西。读它不需要相信任何内部结构，而且探测脚本本来就要定位它——两侧用同一个证据源，验证才有意义。

`followReactFiber` 仍然保留，但只用于**发现控制器实例**（`stateNode`），不用于读数。发现错了顶多找不到，不会读错。

### 12.3 抖音条目随代码发布，但标 `candidate`（现已转 `verified`）

初版建议"注册表默认空，验证后准入"。实现选择"默认带条目、标 candidate"，因为安全边界不在条目是否存在，而在**投影证人是否可读**：

- 找不到控制器 → 桥回 `supported:false` → 退回通用发现 → 与今天完全一致；
- 找到控制器但投影不可读 → 条目无法承载写入（§3.1 规则 2）→ 同样退回；
- 找到且投影可读 → 写入走站点自己的 setter，这就是修复本身。

也就是说，条目存在不会让抖音变差，只会在条件满足时变好。而 `verified` 仍然——且只能——由 §8.2 的实机闸门授予。该闸门已于 2026-11-01 通过（见 12.4），条目现为 `revision: 2 / status: 'verified'`。

### 12.4 实机复核推翻了三条设计假设（契约随之扩展）

§8 的闸门在真实标签页跑完后，暴露了三件静态分析看不出来的事。每一条都要求注册表多一个字段，而不是把特例塞进桥里：

| 实机事实 | 后果 | 新增字段 |
|---|---|---|
| 控制器不在 `video` 祖先链上（`candidateCount=0`），实例在 `window.player` | 关联键再多也搜不到 | `discovery.globalPaths: string[]`（全局点路径，命中即视为声明知识） |
| `player.playbackRate` 是媒体元素的代理，写入成功却不动 UI | "能读回"不能当作"UI 认同" | `discovery.readPath: string \| null`（指向 UI 真正渲染的字段） |
| 面板列出 `0.75x … 3.0x`，只有一项带 `select` | 取第一个匹配会读到 0.75 | `projection.selectedSelector` |
| 页面同时存在预加载播放器 | 文档首个徽标未必属于这个 video | `projection.rootSelector`（从媒体元素向上定位容器） |
| React 把 `{rate}x` 拆成 `"1.5"` + `"x"` 两个文本节点 | 逐节点锚定匹配全数失败 | 选中项改读元素 `textContent` |

前三项是**契约扩展**，后两项是**缺陷修复**。它们共同说明一件事：声明式适配器的字段不是"给启发式调参"，而是"把站点事实写成数据"——字段不够时应当扩契约，而不是放宽白名单。

拒绝写入的边界也因此更硬：`readPath` 与投影共同构成"这个站点到底认不认这次写"的判据。实机 `stale` 夹具（setter 动速率、不动 `playBackRatio`）现在会被桥**拒绝并回滚**，而不是留下一个 UI 否认的速率。

### 12.5 更新后的证据索引

| 证据 | 命令 | 结果 |
|---|---|---|
| 单位与集成测试 | `bun run test:unit` | 124 / 124 文件通过 |
| 严格 lint | `bun ../../scripts/run-strict-biome.ts .` | 见提交记录，0 诊断 |
| 类型 | `bun tsc --noEmit` | 通过 |
| 真实抖音只读探测 | `bun tools/probes/run-douyin-live.ts` | `supported=true` / `adapter=douyin-speed` / 祖先链 0 候选 |
| 真实抖音端到端 | `bun tools/probes/verify-douyin-live.ts` | **12 / 12** |
| 声明式适配器端到端 | `bun tools/probes/verify-declared-adapter.ts` | 20 / 20 |
| 探测脚本自证 | `bun tools/probes/verify-probe.ts` | 19 / 19 |

---

## 11. 引用索引

| 文件 | 关键符号 | 与本方案关联 |
|---|---|---|
| `src/content/injector/page-media-bridge.ts` | `capabilityFor` / `controllerAssociation` / `collectControllerCandidates` / `onPageMediaRequest` | discovery 白名单、回滚；adapter 集成点 |
| `src/content/logic/native-media-executor.ts` | `RestorableMediaWriter` / `readRestorableMediaFieldForWrite` / `writeRestorableMediaFieldWithStableAck` / `handleMediaEvent` | writer 选取、稳定 ACK、观察守卫 |
| `src/content/logic/native-media-async.ts` | `writeWithStableEventAck` / `waitForNativeEvent` | 事件-静默窗口、确认证明 |
| `src/content/logic/native-write-confirmation.ts` | `readActual` / `NativeWriteConfirmationRegistry` | 确认读回（须改为 UI 投影） |
| `src/content/logic/native-write-policy.ts` | `resolveNativeWriteMode` / `recordNativeWriteOutcome` | ledger 降级（须接入投影 drift） |
| `packages/contracts/src/control.contracts.ts` | `CONTROL_STRATEGIES` / `CONTROL_STRATEGY_RULES` / `ControlFieldState.strategy` | 证明 wire 枚举不可轻改（§2.4） |
| `packages/contracts/src/spectra.ui-control-runtime.ts` | `FIELD_STRATEGIES.speed` | 路由契约仍为 `page-native, dom-native` |
| `apps/extension-spectra/tools/probes/douyin-speed-probe.js` | `run` / `tryWrite` | §8 实机取证 |
| `apps/extension-spectra/tools/probes/verify-probe.ts` | 19 项断言 | §8.3 脚本自证 |
| `docs/principles/05-problem-to-principle-map.md` | 抖音条目 | 声明式 one-shot adapter（本方案来源） |
| `docs/control/04b-source-algorithms.md` | youtube-adapter 退役段 | 硬编码 MAIN 文件的先例与禁令 |
| `docs/control/01-foundations.md` | 控制流图 | one-shot official API 节点 |
| `docs/control/04a-algorithm-matrix.md` | `speed` 行 | 路由与 page-native 设计目的 |
| `research/2026-11-01-spectra-douyin-speed-sync-root-cause.md` | 全文 | 根因证据（本方案前提） |
| `research/2026-11-01-spectra-douyin-speed-probe-runbook.md` | 全文 | §8 执行手册 |

