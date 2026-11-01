# SPECTRA 媒体控制系统 · 全架构优化设计

- **日期**：2026-11-01
- **状态**：**P0 四项已落地**（O1 投影真值源、O4 声明式站点画像、O5 路由三档不扩 wire、O10 divergence 测试矩阵），随 `douyin-speed` 条目一并提交；P1/P2 仍为提案。各条目的「落地」小节记录实际形态与偏离。
- **范围**：媒体控制主链路（发现 → 路由 → 写入 → 证据 → 观察 → ledger → 快照/投影）+ 支撑它的契约、测试、性能、治理四个跨切面。音频捕获、弹窗 UI、远端控制的专项优化列为"跨域适用性"（§10），不在本次逐项展开。
- **上游**：
  - `architecture/2026-11-01-spectra-media-control-system-architecture.md`（系统现状总览）
  - `research/2026-11-01-spectra-douyin-speed-sync-root-cause.md`（根因证据）
  - `proposals/2026-11-01-spectra-douyin-speed-official-adapter.md`（第一个用例）
  - `research/2026-11-01-spectra-douyin-speed-probe-runbook.md`（取证方法）

---

## 0. 摘要

现状的问题不是"某个站点有 bug"，而是**三个结构性选择叠加**：

1. **发现即授权**：能不能写，取决于通用启发式能否猜到站点的方法名（4 名 / 7 键 / 12-96-8）。
2. **DOM 即真相**：写入确认、事件观察、站点 ledger 全部只读 `element.playbackRate`。
3. **无异常即成功**：证据只有"读回相等"这一档，没有"从哪里读、可信到什么程度"的分层。

三者相乘的结果是：**抖音倍速写错了，而且系统永远不会知道**。

优化主线一句话：

> **发现可以宽，写入必须窄；真相必须分层，证据必须留痕。**

四条原则：

| 原则 | 含义 | 反例（现状） |
|---|---|---|
| **P1 Declared over discovered** | 已知站点的能力由声明表给出，通用发现只作兜底 | 抖音只能靠猜方法名 |
| **P2 Evidence over assertion** | ACK 携带"证据来源 + 强度"，不以"没报错"代替"已验证" | `confirmed` 只证明 DOM 相等 |
| **P3 Layered truth** | wire 值 / 元素值 / 投影值三层显式区分，不做隐式合并 | 三层被压成 `element.playbackRate` |
| **P4 Narrow writes, broad reads** | 写入口收敛且可审计；读/诊断可以更宽 | 读也窄，导致失明 |

12 个优化项，分 3 批：**P0 四项**（证据分层、声明式画像、路由不带 wire、测试矩阵），**P1 六项**，**P2 两项**。

---

## 1. 评估框架

"优化"在本项目里必须可度量、可验收，否则只是重构偏好。采用五维评估：

| 维度 | 问题 | 验收方式 |
|---|---|---|
| 正确性 | UI 与真实状态是否一致 | divergence 夹具：投影不符必须判 `drifted` |
| 可观测性 | 失败能否被系统自己发现 | ledger 是否产生 drift；诊断导出是否含证据来源 |
| 可逆性 | 失败能否干净回滚 | 回滚后基线读回一致；无残留监听/定时器 |
| 性能 | 一次写要扫多少对象 | 写路径发现扫描次数、p95 写延迟 |
| 演进成本 | 新增一个站点要改几处 | 变更半径（文件数 / 契约变更数） |

**现状基线（静态可得，非实测）**：

- 一次 `page-native` speed 写，跨世界读回至少 3 次（桥内 before/after + `stablePageReadback` 终读），每次读都重跑一遍候选扫描；
- 扫描上限为 12 层祖先 × 96 个自有属性，每个属性做 ≤8 层原型查找，每个候选再做最多 20 次关联键读取；
- `findCapability` 对**每个**候选额外调用 `capabilityCount`（内部再跑 3 次 `capabilityFor`），即使只需要 1 个字段；
- `NativeMediaExecutor` 单类约 1.57k 行（文件 2069 行），持有 7 个按 target/field 索引的 Map、1 个 Set、1 个可变 patch 对象。

这些不是"感觉慢"，是可以在优化后直接对比的结构量。

---

## 2. 不可协商约束

以下约束来自 `unified-design-2026-10-28.md` 与 `control/08-invariants-and-gates.md`，任何优化不得削弱：

1. **单一权威**：每个字段在任一时刻只有一个 owner，跨上下文无共享可变状态。
2. **一次 ACK**：一次 intent 一次确认，不做"先乐观后纠正"的双重叙事。
3. **唯一写者**：媒体元素只由 `NativeMediaExecutor` 写；其它上下文只能请求。
4. **Native-first**：`observe → 精确 DOM/Chrome native → one-shot 官方 API → 可逆增强 → unsupported`。
5. **证明不删除**：证据可过期、可被新写取消，但不可被静默丢弃。

附加（本设计新增，用于防止"优化"变成扩张）：

6. **不新增 MAIN 注入**（SCTRL-004）；站点知识以数据形式进入既有 allowlisted 桥。
7. **不改封闭 wire 枚举**（`ControlStrategy` 承载位序与规则元组）；内部路由与证据可以扩，协议不扩。
8. **不引入常驻监听器**换可观测性；一切读回仍在 bounded 窗口内。

---

## 3. 现状结构性缺陷（带证据）

| 编号 | 缺陷 | 证据（符号） | 后果 |
|---|---|---|---|
| D1 | 发现白名单过窄 | `page-media-bridge.ts`：`capabilityFor` 的 3 个 setter 名 + 1 个 getter；`controllerAssociation` 的 7 个键；`MAX_ANCESTOR_DEPTH=12`、`MAX_ATTACHED_PROPERTIES=96`、`MAX_PROTOTYPE_DEPTH=8` | 抖音 speed 永不命中 → 降级 `dom-native` |
| D2 | 真相源单一 | `native-write-confirmation.ts:readActual`、`native-media-executor.ts:readDomRestorableMediaField`、`handleMediaEvent`、`writeWithStableEventAck` | UI 与 DOM 分叉时，四个环节同时失明 |
| D3 | 语义混叠 | `RestorableMediaWriter = 'page-native' | 'dom-native'` 既表示"发现的控制器"也表示"官方声明路径" | 无法表达"声明优先"而不改 wire |
| D4 | 写路径重复全量扫描 | `findCapability` 每次调用重建候选；`stablePageReadback` 终读再扫一次 | 拖动/连击时成本线性叠加 |
| D5 | 证据扁平成布尔 | `ControlFieldState.writeState: written/confirmed/drifted/unconfirmed` 无来源维度 | "confirmed" 可能只证明 DOM，不证明 UI |
| D6 | 执行器上帝对象 | `NativeMediaExecutor` 1.57k 行，7 个索引 Map + 待写/观察/回放/成熟度四套状态机交织 | 改动半径大，回归风险高 |
| D7 | 站点知识硬编码 | 无声明表；`youtube-adapter.ts` 退役后无承载处 | 每遇新站点只能改启发式 |
| D8 | 时间窗代替因果 | pending 守卫用固定窗口抑制观察 | 窗口内用户手动改速会被吞 |
| D9 | 文档引用会腐烂 | 现有文档大量 `:行号` 引用 | 重构后引用失效，评审无法核对 |
| D10 | 测试只覆盖"DOM 与 UI 一致"的世界 | `test/smoke/page-media.spec.ts` 的夹具 UI 直接反映元素属性 | divergence 类 bug 无护栏 |

> D4 的量化口径：一次 `page-native` 写触发的扫描次数 = 桥内 2 次（before / after）+ 终读 1 次 = 3 次；若 `stableReadback` 的 rAF 边界期间页面自愈，轮询会再叠加。

---

## 4. 目标架构

### 4.1 数据流

```
Intent
  → ControlCoordinator            （唯一权威，revision/ACK 语义不变）
  → SiteCapabilityRouter          （新：host+field → 路由决策）
       ├─ declared  → DeclaredRoute   （注册表条目：setter/association/limits）
       ├─ discovered→ DiscoveredRoute （现有通用发现，加缓存）
       └─ dom       → DomRoute        （element 属性）
  → WriteTransaction              （新：写入 + 回滚 + 证据采集，单一职责）
  → EvidenceCollector             （新：按路由的证据策略读回）
       ├─ element 证据（现状）
       └─ projection 证据（UI 标签 / 组件状态）
  → OwnershipLedger               （现有 ledger + 投影级 drift）
  → Snapshot / Projection         （不变）
```

### 4.2 四个新抽象

1. **`TruthSource`**：`{ kind: 'element' | 'controller' | 'projection', read(), confidence }`。所有确认/观察接受它，而不是各自硬编码读法。
2. **`WriteRoute`**：`'declared-official' | 'page-native' | 'dom-native'`，只存在于内部，不上 wire。
3. **`SiteCapabilityProfile`**：per `host+field` 的声明条目 + 实测边界 + 版本 + 失效指纹。
4. **`EvidenceBundle`**：`{ field, desired, actual, source, at, strength: 'strong' | 'weak' | 'unavailable' }`，写给 ledger 与诊断导出。

### 4.3 一条硬规则

> **写入口只看 `WriteRoute`，不猜站点；读入口只看 `TruthSource`，不假设 DOM。**

这两句是后续所有优化的判据：任何改动若让"写"依赖启发式、或让"读"写死 `element.x`，就不接受。

---

## 5. 优化项

### O1 · 投影真值源（P0）

> **已落地**。`shared/site-adapter-registry.ts` 的 `projection`（文本扫描 + 容差）→ 桥内 `projectionFor()` → 结果字段 `projection` → `NativeWriteConfirmationRegistry.auditProjection()` → ledger `drifted`。偏离：投影是**证人而非闸门**，理由见适配器方案 §12.1。


**问题**：D2。所有读回只看 DOM，UI 分叉不可见。

**设计**：
- 新增 `TruthSource` 抽象；`readActual(field, truth)` 由调用方注入；
- `NativeWriteConfirmationRegistry.schedule` 接收 `TruthSource` 而非裸 `element`；
- `handleMediaEvent` 的发散判定对命中声明的 host 追加投影比较；
- 投影不可读时降级为 element 证据，并标注 `strength:'weak'`，**不得**伪装 `confirmed`。

**改动面**：`native-write-confirmation.ts`、`native-media-executor.ts`（观察与写确认）、`native-write-telemetry.ts`（新增 source 维度）。

**验收**：
- 新夹具"状态驱动标签"（已有：`tools/probes/fixtures/douyin-like-player.html`）下：DOM 写 → `drifted`；声明 setter 写 → `confirmed`；
- 现有 DOM 一致夹具行为不变（快照/ACK 字段逐项相等）。

**风险**：投影读取本身可能抛错或抖动 → 必须有 `unavailable` 档，且不得因此阻断写入。

---

### O2 · 证据分层（P0）

**问题**：D5。`confirmed` 是布尔，无法区分"元素确认"与"UI 确认"。

**设计**：
- `EvidenceBundle` 随 ACK 内部传递（不上 wire），ledger 按 `source` 分桶统计；
- 诊断导出（本地）增加 `evidence` 段：每字段最近 N 次的 source/strength；
- `writeState` 枚举不变——用既有 `drifted` 表达"投影不符"，避免协议变更。

**验收**：诊断导出能回答"这次 confirmed 是 DOM 还是投影"。

**风险**：内存增长 → 环形缓冲，固定 N。

---

### O3 · 失败分类学（P1）

**问题**：现在所有失败都收敛成 `unconfirmed` 或抛错，无法区分"能力缺口"与"页面敌意"。

**设计**：`NativeWriteFailure = capability-gap | projection-gap | hostile | transient | cancelled`。

- `capability-gap`：找不到 setter → 不重试，直接降级路由；
- `projection-gap`：setter 生效但 UI 不动 → 记 drift，软禁用声明路由；
- `hostile`：setter 抛错/回滚失败 → 退避，避免打穿页面；
- `transient`：rAF 超时/元素替换 → 允许一次重试；
- `cancelled`：生命周期中止 → 静默。

**验收**：错误分类在 telemetry 中可计数；每类有明确下一步（重试/降级/停用）。

---

### O4 · 声明式站点能力画像（P0）

> **已落地**。`SiteAdapterEntry` + `SITE_ADAPTER_REGISTRY` + `resolveSiteAdapter(host, field)`，由既有 allowlisted 桥消费，无新增 MAIN 注入。补强：通用词表上提为 `GENERIC_PAGE_MEDIA_VOCABULARY`，使「条目不得重复通用名」成为可测断言。


**问题**：D1 + D7。

**设计**：`shared/site-adapter-registry.ts`（纯数据，桥与执行器共享引用）：

```ts
interface SiteCapabilityProfile {
  host: string;                 // 精确主机名
  field: 'speed';               // 现阶段仅 speed
  version: number;              // 条目版本，便于灰度与复审
  setterNames: string[];        // 实测顺序
  getterNames?: string[];
  accessorProp?: string;
  associationKeys: string[];    // 实测键 + 旧键回退
  allowReactFiber: boolean;
  maxAncestorDepth?: number;
  maxAttachedProperties?: number;
  projection:
    | { kind: 'dom-label'; selector: string; pattern: string }
    | { kind: 'react-state'; component: string; prop: string };
  admission: { evidence: string; verifiedAt: string };  // EPR-028 证据指针
}
```

**关键约束**：`admission` 必须指向已落盘的探测证据 JSON；无证据条目不合并（CI 校验文件存在性）。

**改动面**：新文件 + 桥内 3 个函数 + 注册表契约测试。

**验收**：新增一个站点只改注册表 1 个文件；桥对未声明 host 行为完全不变（快照回归）。

---

### O5 · 路由三元组，但不扩 wire 枚举（P0）

> **已落地**。`RestorableMediaWriter` 增加 `declared-official`；`wireStrategy()` / `observationStrategy()` 把它折回 `page-native`，`CONTROL_STRATEGIES` 未动。


**问题**：D3。

**设计**：
- `RestorableMediaWriter` 扩为三值（内部）；
- wire `strategy` 仍报 `page-native`，`coverage` 不变；
- 三处 `writer === 'page-native' ? stablePageReadback : stableReadback` 收敛为 `stableReadbackFor(writer)`，把"路由 → 证据策略"的唯一映射放在一处。

**为什么不加 `ControlStrategy`**：`CONTROL_STRATEGIES` 是稳定 wire 枚举并承载位序；`CONTROL_STRATEGY_RULES` 每个策略有六维元组且被契约测试锁定。为一个字段加一个枚举值，会连带改协议、规则表、UI 分组与恢复路径——收益/风险不成比例。

**验收**：契约测试全绿且 `FIELD_STRATEGIES.speed` 不变；`restore-page-settings` 行为不变。

---

### O6 · 发现缓存与失效（P1）

**问题**：D4。

**设计**：
- `WeakMap<HTMLMediaElement, Map<field, {capability, at, generation}>>`；
- 失效条件（任一）：TTL（2s）、`loadedmetadata`/`emptied`/`loadstart`、写失败、路由切换；
- **不用** MutationObserver（违反"无常驻监听"约束）；
- `findCapability` 里 `capabilityCount` 改为惰性：仅在候选打平时计算。

**验收**：一次写的桥内扫描从 3 次降到 ≤1 次；缓存失效后行为与现状一致；无陈旧路由（写失败即失效）。

**风险**：SPA 换播放器实例但复用同一 `<video>` → TTL + `emptied` 兜底；若仍出现陈旧，退化为"仅缓存 1 个帧边界"。

---

### O7 · 执行器拆分（P1）

**问题**：D6。

**设计**：保持 `NativeMediaExecutor` 为 facade，内部抽出 5 个协作对象：

| 协作对象 | 负责 | 现状对应 |
|---|---|---|
| `MediaReadModel` | 字段读取 + 上下文/playing 组合 | `read` / `primeObserved` |
| `WriteTransaction` | 写 + 回滚 + 稳定 ACK | `writeRestorableMediaFieldWithStableAck` / `pageCandidateRestoredBaseline` |
| `ObservationRouter` | 事件 → 字段 → pending 判定 | `handleMediaEvent` / `reconcileExpiredPending` |
| `OwnershipLedger` | 每元素每字段 owner/baseline/lastApplied | `nativeMediaOwnership` + `pending` |
| `SiteCapabilityRouter` | host+field → 路由与能力 | 新增（O4/O5） |

**前置**：先用 characterization tests 固化现状（对同一组事件序列断言 patch/字段状态），再拆。**不改变对外行为**。

**验收**：拆前后同一批测试逐项相等；执行器文件行数下降 ≥50%；新增路由只需改 1 个协作对象。

---

### O8 · pending 从时间窗改为写入令牌（P1）

**问题**：D8。

**设计**：
- 每次写生成 `writeToken`（单调递增）+ 期望值；
- `handleMediaEvent` 只在"事件携带的现值 == 期望值 且 token 未过期"时抑制一次观察；
- 用户在窗口内手动改速 → 现值 ≠ 期望值 → 正常上报，不被吞。

**验收**：夹具模拟"写后 200ms 用户改速"，现状会吞、优化后上报。

**风险**：页面在写入后归一化数值（如 1.5 → 1.4999）→ 用现有容差判定，token 带容差。

---

### O9 · 契约与文档可执行化（P1）

**问题**：D9。

**设计**：
- `FIELD_STRATEGIES` → 生成 docs 表格（单一事实源，禁止手抄）；
- 文档引用从 `:行号` 改为**符号锚点**（`file#symbol`），CI 校验符号存在；
- 提案/研究文档头部强制 `关联符号` 字段，缺失即 fail。

**验收**：改一个策略行后，文档表格自动更新；删除一个符号后 CI 报错并指出引用位置。

**收益**：本仓库文档量已很大（`docs/` + `apps/extension-spectra/docs/`），行号引用是当前最大的维护负债。

---

### O10 · 测试矩阵扩展（P0）

> **已落地**。`test/site-adapter-registry.spec.ts`（9 项）+ `test/page-media-declared-adapter.spec.ts`（4 项 divergence 矩阵）+ `tools/probes/verify-declared-adapter.ts`（真实构建产物 20 项）。端到端验证在首轮就抓出了「声明名重复通用名导致优先级退化」的真实缺陷。


**问题**：D10。

**设计**：三层，各自回答不同问题：

| 层 | 载体 | 回答 |
|---|---|---|
| 单元 | bun test + fake element | 纯逻辑：路由选择、证据判定、ledger 降级 |
| 夹具 | puppeteer + `tools/probes/fixtures/*` | 真实 DOM/React 形状：divergence、shadow DOM、抛错 setter |
| 冒烟 | 真实构建扩展 + Chrome | 端到端：注入、ACK、badge、恢复 |

**必须新增的夹具**（现有探测夹具可直接复用/扩展）：

1. `state-driven`：标签由状态渲染（已有）；
2. `closure-only`：控制器只能经闭包访问（验证 `unreachable-controller` 分支）；
3. `hostile`：setter 抛错 / 回滚抛错（验证 `hostile` 分类与不残留）；
4. `shadow`：播放器在 ShadowRoot 内（验证 `composedParent` 路径）。

**验收**：每个夹具至少有 1 条"现状会失败、优化后通过"的断言（否则它没有验证价值）。

---

### O11 · 性能预算与遥测出口（P2）

**问题**：D4/D6 的度量缺失。

**设计**：
- 指标：写路径发现扫描次数、跨世界往返次数、写 p50/p95、投影读取失败率；
- 预算：单次 speed 写 ≤1 次扫描、≤3 次跨世界往返、p95 ≤ 一帧；
- 遥测进入本地诊断导出（不上传），并在性能测试里设门槛。

**验收**：`test:performance` 增加一项"媒体写路径预算"，超预算即失败。

---

### O12 · 条目治理与灰度（P2）

**问题**：声明表一旦存在，会腐烂。

**设计**：
- 条目带 `version` + `verifiedAt` + `evidence`；
- 灰度：`enabledHosts` 白名单逐步放量；失败率超阈值自动软禁用；
- 复审提醒：条目超过 N 天未复验，诊断页标记 `stale`（不自动删除）。

**验收**：故意让条目 setter 失效，系统在 M 次写内软禁用并回退通用路径，且诊断导出可见原因。

---

## 6. 分批与依赖

| 批次 | 优化项 | 依赖 | 可独立上线 |
|---|---|---|---|
| **A（止血 + 护栏）** | O4、O5、O1、O10 | O4/O5 先行；O1 依赖 O5 的路由 | 是（A1：O4+O5 仅桥与注册表；A2：O1+O10） |
| **B（结构）** | O6、O7、O8、O2、O3、O9 | O7 需先有 characterization tests | 是（逐项） |
| **C（运营）** | O11、O12 | 依赖 A/B 的遥测与路由 | 是 |

**关键顺序约束**：

- O5 必须早于 O1：没有路由，证据策略无处挂载；
- O7 必须在 O1/O2 之前或同期：否则证据逻辑继续堆进上帝对象；
- O10 必须与 O1 同批：否则"投影确认"没有回归护栏（与抖音方案 §10 的约束一致）。

---

## 7. 度量（优化前后如何证明有效）

| 指标 | 定义 | 基线采集方式 | 目标 |
|---|---|---|---|
| UI 一致率 | 投影相符次数 / 投影可读次数 | 诊断导出（新） | 抖音 speed 从"不可见"变为可见，并趋近 100% |
| 静默失败率 | `confirmed` 但投影不符的次数 / `confirmed` 次数 | ledger + 证据分桶 | 0 |
| 写路径扫描次数 | 每次 speed 写的 `findCapability` 调用数 | 计数器（开发构建） | ≤1 |
| 写 p95 | intent → ACK | 现有 `native-write-telemetry` | ≤16ms（不含事件等待） |
| 变更半径 | 新增站点所需改动文件数 | 代码评审 | 1（仅注册表） |
| 回归逃逸 | 上线后新发现的 divergence 站点数 | 诊断导出 | 逐季下降 |

> 不给"优化前数字"——现状没有投影维度，任何数字都会是编的。基线必须在 O2 落地后用同一口径采集一次。

---

## 8. 不变式对照

| 优化 | SCTRL-004 无新 MAIN | SCTRL-027 一次 ACK | SCTRL-046 新写取消旧证明 | 单一写者 | Native-first |
|---|---|---|---|---|---|
| O1 投影真值 | 不涉及 | 保持（仍一次 ACK） | 保持（token 化后更强） | 不涉及 | 补强（官方 readback） |
| O2 证据分层 | 不涉及 | 保持 | 保持 | 不涉及 | 不涉及 |
| O4 声明画像 | 满足（数据进既有桥） | 不涉及 | 不涉及 | 不涉及 | 补强（one-shot 官方 API） |
| O5 路由三元组 | 不涉及 | 保持 | 不涉及 | 保持 | 补强 |
| O6 缓存 | 不涉及 | 不涉及 | 需保证失效即重取 | 保持 | 不涉及 |
| O7 拆分 | 不涉及 | 保持 | 保持 | 保持 | 不涉及 |
| O8 令牌 | 不涉及 | 保持 | **直接实现** | 不涉及 | 不涉及 |

结论：无一项需要放宽既有不变式；O8 反而把 SCTRL-046 从"窗口近似"变成"因果判定"。

---

## 9. 反模式（明确不做）

1. **不做通用播放器爬虫**：把方法名匹配放宽到正则、自动尝试调用，会把"写"变成赌博，违反 EPR-028 与可逆性。发现可以宽（诊断），写入必须窄（声明/已验证）。
2. **不新增 MAIN 注入**：即使能解决抖音，也破坏 allowlist 的唯一性。
3. **不扩 wire 枚举来区分路由**：协议成本远大于收益。
4. **不用 MutationObserver 换可观测性**：常驻监听与"bounded 窗口"约束冲突。
5. **不把投影读取放进热路径循环**：投影读一次就够，读不到就降级，不重试到超时。
6. **不为单个站点 fork 执行器**：站点差异只能进注册表，不能进 `if (host === ...)`。

---

## 10. 跨域适用性（候选，需另行验证）

以下方向遵循同一组原则，但**本次未逐项核实**，仅登记为后续候选：

| 域 | 同构问题 | 候选做法 | 优先级 |
|---|---|---|---|
| 音频增强（webaudio/capture） | "增益已设"不等于"用户听到" | 用可测输出（AnalyserNode）作强证据，替代参数读回 | P2 |
| 弹窗/侧栏 | 投影来自快照，可能落后于内容脚本 | 已有 `control-snapshot-order` 约束；补充"陈旧快照"标记 | P2 |
| 远端控制 | 指令重放可能重复执行 | 引入幂等键 + 有界操作队列（已有队列，缺幂等） | P2 |
| 站点热键 | 站点自身快捷键与扩展冲突 | 复用"声明式画像"登记站点级冲突 | P2 |

这些方向共享 O2（证据分层）与 O4（声明画像）的机制，不需要新框架。

---

## 11. 引用索引（符号锚点）

| 文件 | 符号 | 用途 |
|---|---|---|
| `src/content/injector/page-media-bridge.ts` | `capabilityFor` / `controllerAssociation` / `collectControllerCandidates` / `findCapability` | D1、O4、O6 |
| `src/content/logic/native-media-executor.ts` | `NativeMediaExecutor` / `RestorableMediaWriter` / `readRestorableMediaFieldWithStableAck` / `handleMediaEvent` | D3、D4、D6、O1、O5、O7、O8 |
| `src/content/logic/native-media-async.ts` | `stableReadback` / `stablePageReadback` / `writeWithStableEventAck` | D4、O6、O11 |
| `src/content/logic/native-write-confirmation.ts` | `readActual` / `NativeWriteConfirmationRegistry` | D2、O1 |
| `src/content/logic/native-write-policy.ts` | `resolveNativeWriteMode` / `recordNativeWriteOutcome` | D5、O2、O3、O12 |
| `packages/contracts/src/control.contracts.ts` | `CONTROL_STRATEGIES` / `CONTROL_STRATEGY_RULES` / `ControlFieldState` | O2、O5 |
| `packages/contracts/src/spectra.ui-control-runtime.ts` | `FIELD_STRATEGIES` | O5、O9 |
| `test/control-contracts.spec.ts` | allowlist 同步断言 | O5、O9、O10 |
| `tools/probes/fixtures/douyin-like-player.html` | `PlayerCore` / `setSpeed` | O1、O10 |
| `docs/control/08-invariants-and-gates.md` | SCTRL 条目 | §2、§8 |

---

## 12. 一页结论

- **最该改的一件事**：把"读回"从 DOM 属性升级为分层真相源（O1+O2）。它同时修好抖音和未来所有同类站点。
- **最便宜的止血**：声明式画像 + 路由三元组（O4+O5），只动"注册表 + 桥"，不改协议、不改枚举。
- **最容易被忽略的**：测试矩阵（O10）。没有 divergence 夹具，任何"修好了"都是不可证的。
- **最不该做的**：为了抖音去放宽通用发现、或新增 MAIN 注入。那会把一个可控的能力缺口，变成不可审计的写权限。
