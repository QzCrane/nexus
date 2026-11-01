# 抖音倍速 one-shot 官方适配器 — 系统化架构方案

- **日期**：2026-11-01
- **状态**：设计（未实现）。本方案仅描述架构、契约与验证计划，不含代码实现。
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
`readRestorableMediaFieldForWrite`（executor `:286-318`）在命中 allowlist 时，优先把 writer 置为 `declared-official`（在 `page-native` 之前）。优先级：
```
declared-official（仅命中 allowlist 的 host+field）
  → page-native（通用发现）
  → dom-native（element.playbackRate）
```

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
正向写后 `ratechange` 仍会被 pending 守卫（`:1734-1747`）抑制一次观察；但 adapter 路径的 ACK 已基于 UI 投影，故守卫仅影响"二次 DOM 观察"，不影响 UI 同步正确性。守卫窗口结束后 `reconcileExpiredPending` 复读 DOM——此处建议**额外复读 UI 投影**，使后续观察也能覆盖 UI 真值（见 §6.2）。

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

在真实抖音标签页（`www.douyin.com` 或对应移动/国际域名）执行探测脚本，逐项确认后才能将条目写入注册表：

1. **方法名探测**：对媒体元素祖先树应用扩展后的候选扫描，打印所有函数名，确认抖音 speed 的 UI 驱动 setter（如 `setSpeed`/`updateSpeed`/`setPlayRate`）与 getter（如 `getSpeed`/`getPlaybackRate`）的真实命名。
2. **关联键探测**：打印控制器持有媒体元素所用的属性名（是否 `videoEl`/`videoRef`/`player`/`instance`/`ref`，或经 React fiber），确认 §3.1 `associationKeys` 与 `allowReactFiber` 的取值。
3. **挂载深度**：记录 speed 控制器距媒体元素的祖先层级与属性序号，确认是否需放宽 `maxAncestorDepth`/`maxAttachedProperties`（默认 12 / 96）。
4. **UI 投影真值源**：定位抖音 speed 标签的真实数据来源——读取 React 组件 state/props/fiber 内存，或 DOM 标签文本（如 `x.xx倍`）。确认其**不依赖** `element.playbackRate`，并产出 §3.1 `uiProjection` 的可解析形式。
5. **写入端到端验证**：调用抖音 UI 实际使用的 setter 改倍速，确认 UI 标签随之更新（证明该 setter 是 UI 驱动路径），并验证官方 getter 读回与标签一致。
6. **回滚验证**：在 adapter 故意写入非法值或拔掉 setter 后，确认 executor 透明回退 `dom-native` 且不抛未捕获错误、不残留监听器。

仅当 1–6 全部确认，`SiteAdapterEntry` 才被评审并入注册表；且 `native-write-policy` 的降级阈值应按抖音实测稳定性校准。

---

## 9. 风险与开放问题

- **抖音前端重构风险**：抖音可能随时改名方法/改结构，使声明式条目失效。缓解：ledger 漂移检测（§5.2）会在失效时自动降级并告警；条目须随抖音迭代复审。
- **React fiber 内存读取的脆弱性**：经 fiber 读 state 依赖 React 内部字段名（如 `memoizedState`/`stateNode`），跨 React 版本可能变。缓解：`uiProjection.kind='dom-label'` 作为更稳的备选（读取标签文本），优先于 fiber 内存读取；二者皆失败则回退。
- **国际化域名**：抖音存在多域名/地区版，注册表须覆盖实际 host 集合（验证阶段枚举）。
- **是否值得为单站点建框架**：权衡是"只给抖音写特例"还是"建通用注册表"。本方案选后者，因其边际成本低（数据表）且能承载未来同类站点，符合 `01-foundations.md:36` 的既定架构节点。
- **UI 投影读回的性能**：每次 speed 写多一次 UI 投影解析，但仍在 bounded 窗口内（沿用现有稳定读回），不影响主路径延迟。

---

## 10. 实施步骤拆解（设计粒度，不含实现）

1. 新增 `SiteAdapterEntry` 类型与空注册表；接入 `injector/page-media-bridge.ts` 的 discovery（按 host 查询覆盖）。
2. 扩展 `capabilityFor` / `controllerAssociation` 支持条目提供的方法名/关联键/放宽边界；`findCapability` 返回统一 `PageMediaCapability`。
3. executor writer 选取增加 `declared-official` 优先级（位于 `page-native` 前）；`writeRestorableMediaFieldWithStableAck` 对 `declared-official` 走 UI 投影读回。
4. 引入 `uiProjection` 读取器（react-state / dom-label 两路），作为 adapter `read` 与确认/观察的真相源。
5. `native-write-confirmation.ts` 与 `handleMediaEvent` 接入 UI 投影 drift 判定（§5.2）。
6. `native-write-policy.ts` 增加 adapter 软禁用/降级阈值（按站点实测校准）。
7. 编写抖音探测脚本（§8），在真实标签页逐项验证后，将抖音条目经评审写入注册表。
8. 补充单测：模拟"UI 投影与 DOM 分叉"的页面，验证 confirmed/drifted 判定与降级；契约测试保证注册表 schema 与桥解析同步（参考 `test/control-contracts.spec.ts` 的 allowlist 同步约束）。
9. 文档更新：`04a-algorithm-matrix.md` 的 `speed` 行增加 `declared-official` 层级；`05-problem-to-principle-map.md:24` 标记已落地；本方案移交 `update-context` 流程同步到权威文档。

---

## 11. 引用索引

| 文件 | 关键行 | 与本方案关联 |
|---|---|---|
| `injector/page-media-bridge.ts` | `:33-35, :150-165, :177-189, :192-208, :221-241, :324-347` | discovery 白名单、回滚；adapter 集成点 |
| `native-media-executor.ts` | `:286-318, :320-338, :354-364, :378-413, :415-441, :1708-1790` | writer 选取、稳定 ACK、观察守卫 |
| `native-media-async.ts` | `:140-152, :176-235, :251-302` | 事件-静默窗口、确认证明 |
| `native-write-confirmation.ts` | `:34-46, :49-116` | 确认读回（须改为 UI 投影） |
| `native-write-policy.ts` | `:27-68, :75-86` | ledger 降级（须接入投影 drift） |
| `docs/principles/05-problem-to-principle-map.md` | `:24` | 抖音倍速 → 声明式 one-shot adapter（本方案来源） |
| `docs/control/04b-source-algorithms.md` | `:73` | youtube-adapter 退役先例 |
| `docs/control/01-foundations.md` | `:36` | one-shot official API 控制流节点 |
| `docs/control/04a-algorithm-matrix.md` | `:138, :195` | speed 路由、page-native 设计目的 |
| `research/2026-11-01-spectra-douyin-speed-sync-root-cause.md` | 全文 | 根因证据（本方案前提） |
