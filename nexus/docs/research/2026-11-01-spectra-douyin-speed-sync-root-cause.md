# 抖音倍速 UI 单向不同步 — 根因排查报告

- **日期**：2026-11-01
- **范围**：SPECTRA 浏览器扩展（`apps/extension-spectra`）的倍速控制链路
- **现象**：插件修改视频倍速后，抖音（Douyin）播放器 UI 标签不同步；反向（抖音 UI 改倍速 → 插件同步）正常；其它网站倍速及插件其它功能同步均正常。
- **方法**：静态代码审计（ISOLATED/MAIN 双世界、page-media V2 桥、native-first 策略、写入确认与 per-site ledger）。
- **证据边界（EPR-028）**：本报告所有"命中哪条白名单缺口"的判定为**代码层面的必然结论**；但"抖音播放器具体用哪个方法名/关联键/挂载层级"未经真实抖音标签页实机验证，须以 `§13` 探测清单坐实后方可宣称已修复。

---

## 1. 结论先行

**异常环节**：抖音 `speed` 写入没有落到能驱动其播放器 UI 的状态上。

**根因（子因 A，已确证为唯一成立）**：通用 page-native 发现（`injector/page-media-bridge.ts` 的 `findCapability`）是一组**白名单式启发式**——speed 仅探测 4 个 setter 名、7 个关联键，且遍历受 12 层祖先 / 每 host 前 96 自有属性 / 8 层原型约束。抖音（React SPA）的 speed 控制器在这些维度上超出白名单，导致 `findCapability('speed')` 返回 `null`，写入被强制降级到 `dom-native`（`element.playbackRate = next`）。抖音 speed 标签由 React 组件 state 驱动、不读 `element.playbackRate` 裸属性，因此真实速率已变、插件 ACK 判定 `applied`、UI 标签却陈旧。

**子因 B（已发现 setter 但不刷新 UI）基本不成立**：若 `findCapability` 成功，其返回的 setter 即抖音 UI 自身改倍速所调用的方法，调用它本应刷新标签；否则抖音手动改倍速也会令标签坏掉，这与"反向同步正常"矛盾。

**关键附加发现（诊断失明）**：扩展的写入确认、事件观察、per-site ledger **全部只读 `element.playbackRate`**（DOM 属性），没有任何环节触达抖音 React state 或 UI 标签。因此系统**结构性无法感知**该 bug——抖音 speed 写入永远被 ledger 记为 `confirmed`，永不 `drifted`，永不触发降级/自愈。

---

## 2. 双方通信机制现状

控制写实存在两个世界，由 page-media V2 桥跨世界同步（`docs/architecture/runtime.md`）：

1. **ISOLATED 世界**（content script，`native-media-executor.ts`）是唯一 writer，按 `page-native → dom-native` 顺序决定写入层。
2. **MAIN 世界**（`injector/page-media-bridge.ts`）负责"精确元素 + 能力发现"：遍历合成祖先、扫描自有属性，寻找与媒体元素显式关联的 controller，要求其具备成对 getter/setter 且 readback 稳定。
3. 跨世界经 DOM 属性 + 合成事件协议同步（`shared/page-media-bridge.ts` 的 request/result 属性；`logic/page-media-bridge.ts` 的 `transact`）。

`docs/control/04a-algorithm-matrix.md:138` 明确 `speed` 路由为 `page-native -> dom-native`，`:195` 注明 page-native 的设计目的就是 "resident page-UI sync"。

### 写入层选取的关键路径（`native-media-executor.ts`）
- `readRestorableMediaFieldForWrite`（`:286-318`）→ 无既有 ownership 时调用 `readRestorableMediaFieldWithWriter`（`:254-284`）。
- 无 ownership 且 `readPageMediaField(element,'speed')` 返回 `null` → 返回 `writer:'dom-native'`（`:273-283`）。
- `writeRestorableMediaField`（`:320-338`）对 dom-native 走 `writeNativePlaybackRate`：`element.playbackRate = next`（`:354-364`）。

---

## 3. discovery 白名单缺陷（根因的具体形态）

`injector/page-media-bridge.ts` 的 speed 能力发现只认以下硬编码约定：

| 维度 | 内容 | 位置 |
|---|---|---|
| setter 探测名（仅 4 个） | `getPlaybackRate`、`setPlaybackRate`、`setPlaybackRateByUser`、`changePlaybackRate`（或 `playbackRate` 访问器对） | `:150-165` |
| 关联键（仅 7 个） | `video`/`media`/`mediaElement`/`element`（media-reference）、`root`/`el`/`container`（root-reference） | `:177-189` |
| 遍历边界 | ≤12 层合成祖先、每 host 前 **96** 个自有属性、≤8 层原型 | `:33-35, :197` |

抖音播放器几乎必然命中以下缺口之一：
- 经 **minified / React-ref 键**（`videoEl`、`videoRef`、`player`、`x`、`ref`、`_video`，或 React fiber `__reactFiber$*` / `__reactInternalInstance$*`）持有媒体元素 → 不在 7 键白名单 → `controllerAssociation` 返回 `null` → 候选在 `:202` 被 `continue` 丢弃；
- 或 speed 方法命名为 **`setSpeed` / `updateSpeed` / `setPlayRate` / `changeSpeed`** → 不在 4 名探测列表 → `capabilityFor` 返回 `null`。

任一情况都让 `findCapability(element,'speed')` 在抖音返回 `null`。

### 一个独立的脆弱点
`:197` 的 `Object.getOwnPropertyNames(host).slice(0, MAX_ATTACHED_PROPERTIES)` 仅取每个 host **枚举序前 96 个**自有属性（非排序）。若抖音某层 host 把 speed 控制器挂在属性序号 >96 处，会被直接跳过——这是与命名/键无关、可独立导致发现的 bug。

---

## 4. 四个维度的差异分析

### 4.1 通信机制差异（写 vs 读路径不对称）
- **写**：必须选定 writer 层。抖音未被通用 bridge 发现 speed controller → 强制 `dom-native`。
- **读/观察**：`handleMediaEvent` 收到 `ratechange` 也走 `readRestorableMediaFieldWithWriter`，但即便 page-native 返回 null 仍回退到 `readDomRestorableMediaField` 读 `element.playbackRate`（`:225-239, :280-283`）。**"反向同步正常"走的是 DOM 回退读，与 page-native 是否被发现无关**，不能以此反证发现成功。

### 4.2 UI 刷新差异（根因核心）
设计上仅 `page-native` 写入（调用站点 controller 的 setter 或访问器）才向站点 UI 状态回流。抖音 UI 由 React state 驱动，不读 `element.playbackRate` 裸属性 → `dom-native` 写只改变媒体元素属性，UI 标签不变。

### 4.3 事件监听差异
- 正向：`dom-native` 写触发 `ratechange`，但 `handleMediaEvent` 的 pending 守卫（`:1734-1747`，SP-70）在 1s 窗口内抑制该字段二次观察；窗口结束后 `reconcileExpiredPending` 复读 DOM 值（与写入一致）→ 不报分叉。
- 反向：抖音 UI 改倍速 → 同时写 `element.playbackRate` + React state → `ratechange` → 插件观察 → 上报，正常。

### 4.4 状态更新差异
- 真实播放速率：正向 `dom-native` 写后确实改变（用户听到快放），插件 ACK 读 `element.playbackRate` 判定 `applied`。
- 抖音 UI 状态：与媒体元素属性解耦，未被正向写触碰 → 陈旧。
- 分叉点就在"写入层"：正向缺少一条能回流到 UI 状态的写入通道。

---

## 5. 子因 A vs B 的判定

- **B 成立的前提**是 `findCapability` 在抖音成功（存在被 4 名+7 键+12/96/8 命中的 speed 控制器），且该 setter 只改 `element.playbackRate` 而不刷新 React 标签。但这要求该 setter 与抖音 UI 自用 setter 不同（UI 自用的不在白名单内，如 `setSpeed`），于是 A 同样为真。净效果一致：**扩展只能触达非 UI 路径 → 标签陈旧**。
- 若 page-native 真被选中而其 setter 抛错，桥会回 `error`、executor 抛 `PageMediaCapabilityUnavailableError`（`native-media-executor.ts:328`），用户会看到写入失败而非"静默不同步"——实际是静默不同步，反证走的是无报错的 `dom-native`。
- **结论**：A 为唯一成立根因；B 即便在边缘情形成立，也共享同一修复路径，且被项目原则图（§12）的既定方向所覆盖。

---

## 6. 诊断失明链路（系统为何永远发现不了此 bug）

### 6.1 写入确认只读 DOM（`native-write-confirmation.ts`）
`NativeWriteConfirmationRegistry.schedule`（`:83-95`）对 speed 调用：
```
confirmStableNativeEvent(element, 'ratechange', () => readActual(element, field), desired, …)
```
`readActual` 对 speed 为 `element.playbackRate`（`:40`）。抖音 dom-native 写改 `element.playbackRate` → `ratechange` 触发 → `matched=true` → `writeState='confirmed'`（`:92`）→ `recordNativeWriteOutcome(siteKey,'confirmed')`。

### 6.2 ledger 永不 drift（`native-write-policy.ts`）
降级仅在 `drifted` 累计 ≥ `driftLimit(2)`（窗口 8）时触发（`:59-68`）。抖音因 DOM 值匹配而永远 `confirmed`，永久停留 `optimistic` 模式，ledger/telemetry 完全不报警。

### 6.3 观察守卫只读 DOM（`handleMediaEvent`）
`ratechange` → `['speed','preservePitch']`（`:1708-1710`）→ `this.read(...)` 对 dom-native 走 `readDomRestorableMediaField` → `element.playbackRate`（`:232`）。pending 守卫（`:1734-1747`）抑制正向写的分叉上报；反向因用户 UI 路径也写 `element.playbackRate` 而能被观测到分叉（`:1752`）。

### 6.4 事务内 ACK 也只读 DOM
`writeRestorableMediaFieldWithStableAck`（`:387-391`）非 page-native 时 `read` 闭包走 `readDomRestorableMediaField`；`writeWithStableEventAck`（`native-media-async.ts:176-235`）的 `read()`/`onEvent` 校验全部基于同一 DOM 读回。

**综合**：插件所有"读/确认/观察"入口只有 `element.playbackRate` 这一真相源；抖音 speed 标签由 React state 驱动、不读该属性，故插件既读不到标签值、也感知不到它陈旧。这是整条诊断链在架构上未触达页面 UI 状态的能力缺口，而非单个环节漏检。

---

## 7. 跨世界桥忠实性

`logic/page-media-bridge.ts` 的 `transact`（`:43-68`）仅在 `!result?.supported` 或结果 JSON 损坏时返回 `null`；MAIN 端 `onPageMediaRequest`（`injector/page-media-bridge.ts:289-298`）在 `findCapability` 返回 `null` 时如实回 `supported:false`。**根因 100% 落在 discovery 白名单，与桥传输无关**。

---

## 8. 自动升级为何失效

`readRestorableMediaFieldForWrite`（`:286-318`）存在 dom-native → page-native 升级分支（`:292-311`）：若已有 dom-native ownership 且某次 `readPageMediaField` 返回非 null，则升级。但升级前提是 allowlist 能发现控制器；抖音控制器命中不了白名单，`readPageMediaField` 永远 null，升级永不触发。首次 speed 写发生在播放器早已挂载之后，故非"晚挂载时序"问题，而是纯白名单 miss。

---

## 9. 仓库内抖音逆向数据核查

对 `reference/`（684 文件）及全仓检索 `setSpeed|updateSpeed|setPlayRate|videoEl|videoRef|getPlaybackRate` 等，命中者均为 imagus / hoverzoom / hls.js / photoshow 等**无关第三方视频库**，不含任何抖音/TikTok 播放器内部结构。**"具体命中哪条白名单缺口"无法静态坐实，必须经真实抖音标签页探测（§13）**。

---

## 10. 端到端因果链

```
抖音 speed 控制器 命名/关联键/挂载层级 超出白名单
  → MAIN findCapability('speed') 返回 null
  → bridge 如实回 supported:false
  → ISOLATED readRestorableMediaFieldWithWriter 降级 writer='dom-native'
  → writeNativePlaybackRate: element.playbackRate = next
  → 真实速率改变（用户听到快放）✓
  → 但抖音 speed 标签读 React state，不读 element.playbackRate → 标签陈旧 ✗
  → ratechange 触发，pending 守卫抑制 + 复读 DOM 一致 → 不报分叉
  → confirmStableNativeEvent 读 element.playbackRate 一致 → writeState='confirmed'
  → ledger 记 confirmed → 永不 drift → 永不降级/自愈
  → 扩展视角：写成功、确认成功、无告警（系统对该 bug 失明）
反向：用户改 UI → 抖音同时写 element.playbackRate + React state → ratechange
  → 插件读 DOM 值变化 → 上报同步 ✓
```

---

## 11. 为什么其它情况正常

- **其它网站倍速正常**：其播放器 UI 要么由被通用 bridge 发现的成对 getter/setter 驱动（page-native 生效），要么 UI 直接读 `element.playbackRate`（dom-native 也能回流）。抖音两者都不满足。
- **抖音其它功能正常**：通用 bridge 对 volume/mute 可能暴露了可发现 controller，或其 UI 直接读 `element.volume`/`element.muted`。问题被精确锁定在"抖音 + speed"这一字段组合。
- **抖音反向正常**：见 §4.3 / §10。

---

## 12. 修复约束（来自项目原则）

- `docs/principles/05-problem-to-principle-map.md:24`：**"抖音倍速 UI 不同步 → 只允许已声明的 one-shot official adapter，成功须有官方 getter/readback"**——即通用发现覆盖不了抖音 speed，修复方向是显式声明的 one-shot adapter。
- `docs/control/04b-source-algorithms.md:73`：曾存在 `youtube-adapter.ts`（`hybrid-state-native`，同时抵达元素与页面态），现已 retired/forbidden——证明"直达页面态"的 per-site 适配器正是为这类 bug 设计的机制，而抖音当前没有任何同类适配器。
- `docs/control/01-foundations.md:36` 控制流图：DOM native 写入 → 稳定 readback → **"typed retryable mismatch only" → Site one-shot allowlisted official API** → snapshot。one-shot 官方 API 是 DOM 回读失配后的既定下一步。
- 相关原则：**EPR-007**（Native-First 策略顺序）、**EPR-002**（Desired/Actual/ACK/Snapshot/UI 分层：ACK 仅证明媒体元素层 actual，不代表页面 UI 投影已更新）、**EPR-028**（结论须以已验证能力为界）。

---

## 13. 待实机验证清单（EPR-028，落地修复前必做）

在真实抖音标签页注入 `findCapability(element,'speed')` 并打印：
1. 候选 controller 的方法名清单——是否出现 `setSpeed` / `updateSpeed` / `setPlayRate` / `changeSpeed`；
2. 关联键——是否经 `videoEl` / `videoRef` / `player` / `instance` / `ref` / React fiber 等非白名单键持有媒体元素；
3. speed 控制器挂载的祖先层级与属性序号——是否 >12 层或 >96 属性；
4. 抖音 speed 标签的**真实数据来源**——读取 React 组件 state / props / fiber 内存，或 DOM 标签文本，确认其不依赖 `element.playbackRate`；
5. 抖音 UI 实际调用的 setter 路径（改倍速时命中的方法），作为官方 adapter 的写入目标。

仅当以上探测确认后，方可声明 one-shot official adapter 并以其官方 getter/readback 成功为 ACK 前提。

---

## 14. 引用索引

| 文件 | 关键行 | 内容 |
|---|---|---|
| `injector/page-media-bridge.ts` | `:33-35, :150-165, :177-189, :192-208, :221-241, :269-298` | discovery 白名单、findCapability、supported:false |
| `logic/page-media-bridge.ts` | `:43-68, :70-110` | ISOLATED→MAIN 桥 transact（忠实返回 null） |
| `native-media-executor.ts` | `:225-339, :354-364, :378-413, :1708-1790` | 读/写路径、dom-native 降级、ratechange 观察守卫 |
| `native-media-async.ts` | `:87-92, :176-235, :251-302` | 稳定 ACK、confirmStableNativeEvent（DOM 读回） |
| `native-write-confirmation.ts` | `:34-46, :49-116` | 写入确认 readActual 仅读 element.playbackRate |
| `native-write-policy.ts` | `:27-68, :75-86` | ledger 仅按 drifted 降级 |
| `docs/control/04a-algorithm-matrix.md` | `:138, :195` | speed 路由、page-native 设计目的 |
| `docs/principles/05-problem-to-principle-map.md` | `:24` | 抖音倍速 → 声明式 one-shot adapter |
| `docs/control/04b-source-algorithms.md` | `:73` | youtube-adapter（hybrid-state-native）退役先例 |
| `docs/control/01-foundations.md` | `:36` | 控制流：DOM → one-shot official API |
