# 抖音倍速 one-shot 官方适配器 — 系统化架构方案

- **日期**：2026-11-01
- **状态**：设计（未实现）。架构与契约尚未落地；§8 的探测脚本、夹具与自证已可用（见运行手册）。
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
新增一个**经评审的静态表**（类比 `media-route` 注册表），每个条目声明：

```ts
interface SiteAdapterEntry {
  host: string;                       // 精确主机名，如 "www.douyin.com"
  field: 'speed';                     // 当前仅 speed；框架可扩展
  // —— 写入目标：抖音 UI 真正调用的 setter ——
  setterNames: string[];              // 候选顺序，如 ["setSpeed","updateSpeed","setPlayRate","setPlaybackRateByUser"]
  getterNames: string[];              // 候选顺序，如 ["getSpeed","getPlaybackRate"]
  accessorProp?: string;              // 或 playbackRate 访问器属性名
  // —— 关联：控制器如何持有媒体元素 ——
  associationKeys: string[];          // 扩展白名单，如 ["videoEl","videoRef","player","instance","ref"]
  allowReactFiber: boolean;           // 是否遍历 React fiber 找持有 element 的组件实例
  // —— UI 投影真值源（修复诊断失明的关键）——
  uiProjection: {
    kind: 'react-state' | 'dom-label';
    // react-state: 经 fiber/组件实例读取 speed 的 UI 真值
    // dom-label: 读取倍速标签 DOM 文本并解析为数值
    selector?: string;                // dom-label 用：标签选择器
    parse?: (text: string) => number; // dom-label 用：文本→数值
  };
  // —— 安装约束 ——
  maxAncestorDepth?: number;           // 可放宽默认 12
  maxAttachedProperties?: number;      // 可放宽默认 96
}
```

注册表**默认空**，抖音条目需经 EPR-028 实机验证（§8）后才准入。未命中 host 时，行为与现状完全一致。

### 3.2 运行期集成点
在 `injector/page-media-bridge.ts` 的 `capabilityFor` / `collectControllerCandidates` / `controllerAssociation` 中：若 `location.hostname` 命中某条目，则用条目的 `setterNames`/`getterNames`/`associationKeys`/放宽后的边界**替代**通用硬编码（4 名 / 7 键 / 12-96-8）。`findCapability` 仍返回统一的 `PageMediaCapability { read, write }` 接口，对 ISOLATED 世界透明。

### 3.3 官方 getter/readback 的硬约束
EPR-028 与原则图要求"成功须有官方 getter/readback"。adapter 的 `read` **必须**返回 §3.1 的 `uiProjection` 真值（UI 投影），而非 `element.playbackRate`。写入流程（§4）以"UI 投影回读 == desired"作为 ACK 前提。这同时修复了 §6 的诊断失明。

---

## 4. 写入与回滚流程

### 4.1 writer 识别
`readRestorableMediaFieldForWrite` 在命中 allowlist 时，优先把 writer 置为 `declared-official`（在 `page-native` 之前）。优先级：

```
declared-official（仅命中 allowlist 的 host+field）
  → page-native（通用发现）
  → dom-native（element.playbackRate）
```

如 §2.4 所述，`declared-official` 只存在于内部 `RestorableMediaWriter` 联合类型，**不进入 wire 的 `ControlStrategy`**。ACK 对外仍报 `strategy: 'page-native'`，`coverage` 仍为 `full`——因为行为确实由页面自己的 setter 完成，语义没有漂移。

这三档路由的差别只在**证据策略**：

| 路由 | 写入通道 | ACK 读回 | 失败语义 |
|---|---|---|---|
| `declared-official` | 条目声明的 setter（经桥） | UI 投影 | 投影不符 → 回滚 + `unconfirmed` |
| `page-native` | 发现的成对 getter/setter | 控制器 getter | 现值不符 → 桥内回滚 + 错误 |
| `dom-native` | `element.playbackRate` | `element.playbackRate` | 现值不符 → `drifted` |

### 4.2 事务内写入（适配器路径）
复用 `writeRestorableMediaField`（`:320-338`）：writer 为 `declared-official` 时调用 `writePageMediaField`（经桥）走 adapter 的 `setter`；随后 `writeRestorableMediaFieldWithStableAck`（`:378-413`）对 `declared-official` 走 `stablePageReadback`，其 `read` 闭包读取 **UI 投影真值**（`uiProjection` 解析结果）。

伪流程：
```
writeRestorableMediaField(element, 'speed', desired, 'declared-official')
  → bridge.writePageMediaField → adapter.setter(desired)   // 抖音 UI setter
  → stablePageReadback(() => adapter.uiProjectionRead())    // 读 UI 投影真值
  → if |uiProjection - desired| > tolerance: throw（触发回滚）
```

### 4.3 回滚与降级
- adapter `set` 抛错或 UI 投影回读失配 → executor 回滚到 `dom-native` 基线（复用现有 `pageCandidateRestoredBaseline` 思路，`:415-441`），并将本次 outcome 记为 `unconfirmed`（非 `confirmed`/`drifted`）。
- 一旦 adapter 在连续 `window` 次内失败 ≥ `driftLimit`，ledger 可降级该 host 的 adapter 启用（软禁用），回退到通用 `page-native → dom-native`，避免反复失败。

### 4.4 与现有 pending 守卫的兼容
正向写后 `ratechange` 仍会被 pending 守卫抑制一次观察；但 adapter 路径的 ACK 已基于 UI 投影，故守卫仅影响"二次 DOM 观察"，不影响 UI 同步正确性。守卫窗口结束后 `reconcileExpiredPending` 复读 DOM——Stage 2 建议**额外复读 UI 投影**，使后续观察也能覆盖 UI 真值（见 §5.2）。

### 4.5 分阶段落地：最小可行路径只动"注册表 + 桥"

把"修 UI 同步"和"修诊断失明"拆开看，会发现前者比预想小得多——因为**现有桥已经强制回读**：`onPageMediaRequest` 写完会 `capability.read()` 并比对 desired，不符就回滚并返回 error。只要 adapter 的 `read` 返回 UI 投影，"写没写进去"当场就能判定。

**Stage 1（最小可行，仅桥 + 注册表）**

- 新增 `shared/site-adapter-registry.ts`（纯数据 + 解析函数），由 MAIN 桥与 ISOLATED 执行器各自打包引用——**不新增注入文件、不改协议、不改 wire 枚举**；
- `capabilityFor` 在 host 命中条目时，直接按条目的 `setterNames` / `associationKeys` / `uiProjection` 构造能力，跳过通用启发式；
- 执行器完全不动：writer 仍是 `page-native`，ACK 仍走 `stablePageReadback`，只是读回值变成了投影。

结果：UI 不同步被消除；若投影解析失败或不符，现有桥回滚并抛错，不会静默成功。代价是失败表现为"这次写入失败"，而不是"漂移被记录"。

**Stage 2（诊断增强，改执行器与确认）**

- `RestorableMediaWriter` 增加 `declared-official`，仅用于选择证据策略与软禁用；
- `native-write-confirmation.readActual` 接受投影读取器；`handleMediaEvent` 的发散判定比较投影值；
- ledger 的 `drifted` 首次反映"UI 未同步"，触发 `resolveNativeWriteMode` 降级。

**Stage 3（稳定性校准）**

- 按抖音实测结果校准 `driftLimit` / 软禁用窗口；
- 条目版本化与失效复检（见 §9）。

这个顺序的意义：Stage 1 的变更面是"一个数据文件 + 桥内三个函数"，可以在不改任何契约的前提下先止血；Stage 2 才动证据模型。若 Stage 1 实测发现投影不可稳定解析，则立即停止，不进入 Stage 2——避免为一个不成立的假设扩大改动。


---

## 5. 诊断可观测性修复（消除失明，关键架构贡献）

### 5.1 失明的根因
`native-write-confirmation.ts:readActual` 与 `handleMediaEvent` 的所有读回都基于 `element.playbackRate`。对"UI 由 React state 驱动"的站点，DOM 属性与 UI 投影分叉，而系统只测 DOM，于是永远 `confirmed`。

### 5.2 提案：UI 投影真值源 + 投影级 drift
1. **写入确认**（§4.2）已改为读 UI 投影——这是第一道修复：adapter 写入后若 UI 仍不同步，确认即判 `drifted`。
2. **观察守卫扩展**：在 `handleMediaEvent` 的 speed 发散判定（`:1752`）中，对命中 adapter 的 host，额外比较"UI 投影真值"与插件 recorded 值；若 UI 投影与插件期望不一致，判为 `drifted` 并上报。
3. **ledger 语义不变**：`recordNativeWriteOutcome` 仍按 `confirmed/drifted/unconfirmed` 记录；但现在 drift 能真实反映"UI 不同步"，从而触发 `resolveNativeWriteMode` 的降级（`:59-68`）——系统首次具备自愈信号。

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


---

## 9. 风险与开放问题

- **抖音前端重构风险**：抖音可能随时改名方法/改结构，使声明式条目失效。缓解：ledger 漂移检测（§5.2）会在失效时自动降级并告警；条目须随抖音迭代复审。
- **React fiber 内存读取的脆弱性**：经 fiber 读 state 依赖 React 内部字段名（如 `memoizedState`/`stateNode`），跨 React 版本可能变。缓解：`uiProjection.kind='dom-label'` 作为更稳的备选（读取标签文本），优先于 fiber 内存读取；二者皆失败则回退。
- **国际化域名**：抖音存在多域名/地区版，注册表须覆盖实际 host 集合（验证阶段枚举）。
- **是否值得为单站点建框架**：权衡是"只给抖音写特例"还是"建通用注册表"。本方案选后者，因其边际成本低（数据表）且能承载未来同类站点，符合 `01-foundations.md:36` 的既定架构节点。
- **UI 投影读回的性能**：每次 speed 写多一次 UI 投影解析，但仍在 bounded 窗口内（沿用现有稳定读回），不影响主路径延迟。

---

## 10. 实施步骤拆解（设计粒度，不含实现）

**Stage 1（最小可行）**

1. 新增 `shared/site-adapter-registry.ts`：`SiteAdapterEntry` 类型 + 空注册表 + `resolveSiteAdapter(host, field)`；由桥与执行器共享引用。
2. 桥内 `capabilityFor` / `controllerAssociation` / `collectControllerCandidates` 支持条目提供的方法名/关联键/放宽边界；命中条目时优先于通用启发式；`findCapability` 仍返回统一 `PageMediaCapability`。

**Stage 2（诊断增强）**

3. executor 的 `RestorableMediaWriter` 增加 `declared-official`（仅内部路由，**不改 `ControlStrategy`**）；`writeRestorableMediaFieldWithStableAck` 对该路由走 UI 投影读回；把三处 `writer === 'page-native' ? stablePageReadback : stableReadback` 收敛为 `stableReadbackFor(writer)`。
4. 引入 `uiProjection` 读取器（react-state / dom-label 两路），作为 adapter `read` 与确认/观察的真相源。
5. `native-write-confirmation.ts` 与 `handleMediaEvent` 接入 UI 投影 drift 判定（§5.2）。
6. `native-write-policy.ts` 增加 adapter 软禁用/降级阈值（按站点实测校准）。

**取证与护栏（贯穿）**

7. 探测脚本已完成并自证（§8.3）；在真实标签页按运行手册执行 §8.2 闸门，通过后把抖音条目经评审写入注册表。
8. 补充单测：模拟"UI 投影与 DOM 分叉"的页面，验证 confirmed/drifted 判定与降级；契约测试保证注册表 schema 与桥解析同步（参考 `test/control-contracts.spec.ts` 的 allowlist 同步约束）。
9. 文档更新：`04a-algorithm-matrix.md` 的 `speed` 行注明"声明式路由仍归 `page-native`，仅内部路由与证据策略不同"；`05-problem-to-principle-map.md:24` 标记已落地；本方案移交 `update-context` 流程同步到权威文档。

> 实施顺序约束：第 3 步必须连同第 8 步的 divergence 单测一起提交，否则"投影读回"只会在抖音上被验证，缺少回归护栏。

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

