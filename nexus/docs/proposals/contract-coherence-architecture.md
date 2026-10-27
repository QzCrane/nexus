---
type: explanation
status: draft
audience: contributor
owner: architecture
last_reviewed: 2026-10-28
---

# 契约一致性架构：把"两份表示"收束为一处

- status: proposal（非行为权威；行为权威是可执行契约、测试、门禁与产物）
- date: 2026-10-28
- scope: `packages/contracts`、`nexus/scripts`（投影与门禁）、`.github/workflows`
- trigger: 2026-10-28 两起生产缺陷——音量回弹 / `invalid SPECTRA extension RPC v2 response`，
  以及公开镜像 `sync-spectra` 连续三个月无法完成

## 1. 结论

两起缺陷不是两个 bug，而是**同一个架构缺陷的两种表现**：

> 系统里存在大量"同一事实的两份表示"，而只有其中一份被编译器或门禁约束。
> 另一份靠人记住。人一旦没记住，缺陷就以"数据在线上被判定非法"的形式出现。

今天实测的存量规模：

| 手写派生结构 | 数量 | 位置 |
|---|---|---|
| 运行时允许键集合与类型并行 | **49** 处（本次改造后 35） | `packages/contracts/src/*.contracts.ts` |
| `hasOnlyKeys` 校验调用点 | **187** 处 | 同上 + `spectra.protocol.ts` |
| 协议动作（请求/响应各一份校验映射） | **148** 个 | `spectra.protocol.ts` |
| 公开投影的人工清单 | **18** 份 | `scripts/sync-public.ts` |

这些数字说明问题不是偶发的疏忽，而是**结构性的**：每新增一个字段、一个脚本、一个动作，
都有多处需要人工同步，而没有任何机制要求它们同步。

## 2. 四个架构性根源

### R1 类型与运行时校验是两份表示，无机械绑定

`ControlFieldState` 在"写入与确认分离"改造中新增 `writeState?: ControlWriteState`。
类型改了，运行时允许键集合 `fieldStateKeys` 没改。`hasOnlyKeys` 用集合判断，
于是**每一个合法的原生写入 ACK 都被判为非法**，Background 丢弃确认，
弹窗退回上一个已确认值——用户看到的是**回弹**，日志里是 `invalid ... RPC v2 response`。

类型检查为什么没发现：集合是 `new Set<keyof T>([...])`，`keyof T` 只约束成员合法，
不约束**完整性**。少列一个键完全合法。

### R2 投影清单是人工枚举，而闭包只覆盖 import 图

公开镜像的投影由三份人工清单决定（脚本文件、`devDependencies`、运行时资产）。
`sync-spectra` 的三处缺口全部落在 import 图之外：

1. `@types/qrcode`——`qrcode` 被 `src` 导入，但没有随包声明文件；
2. `production-size-policy.json`——脚本运行时用 `new URL()` 读，不是 import；
3. `check-lean-hotkey-artifact.ts`——只在 `package.json` 的 `build` 命令里出现，
   没有任何 `import` 指向它。

三者都在投影"成功"之后才在目标树里爆炸：投影报 OK，目标仓库 typecheck/build 失败。
**自检发生在被检对象内部，而缺少的正是被检对象之外的依赖。**

### R3 校验点放在最晚、最少执行的边界

| 能拦住今天缺陷的门禁 | 实际执行时机 |
|---|---|
| 单元测试（生产者侧断言） | 已进 pre-push（今天才加） |
| 端到端 ACK 校验 | 从未存在——测试只断言自己关心的字段 |
| 公开投影完整构建 | `workflow_dispatch` 手动触发 |
| 发布 smoke | 仅在发布时 |

所以缺陷的存活期 = 从合并到下一次发布或用户使用。**门禁存在，但站在错误的边界上。**

### R4 门禁按源码字面形状解析，被重构即失效

`SCTRL-041` 用正则从源码里抠 `const submitKeys = new Set<keyof ControlSubmitRequest>([...])`。
本次把该声明改为 `keySetOf<ControlSubmitRequest>()([...])` 后，门禁立刻误报。
这不是我这边的回归，而是**门禁自身的脆弱性**：它断言的是拼写，不是行为。
同类风险存在于所有 source-scanning 检查中。

### 附带的第五点：生产者侧断言替代了线端契约断言

`native-media-executor.spec.ts` 断言 `result.fields.volumeBase?.writeState === 'written'`，
全绿。但它断言的是"我关心的一个字段"，而线上判定的是"整个 payload 是否合法"。
**测试覆盖了生产者，没有覆盖边界。** 这正是缺陷能穿过 118 个测试文件的原因。

## 3. 改进方案

### M1 契约绑定：让漏键成为编译错误（已落地）

新增 `packages/contracts/src/key-set.ts`：

```ts
export type CompleteKeys<T, K extends readonly (keyof T & string)[]> =
	Exclude<keyof T, K[number]> extends never
		? K
		: K & { readonly missingKeys: Exclude<keyof T, K[number]> };

export function keySetOf<T>():
	<K extends readonly (keyof T & string)[]>(keys: CompleteKeys<T, K>) => ReadonlySet<string>;
```

不变量：**允许键集合必须列全 `T` 的每个键**。漏一个键时，参数类型变成
`K & { missingKeys: '<漏掉的键>' }`，编译直接失败并点名缺哪个键。

实测（变异验证）：从 `fieldStateKeys` 删掉 `'writeState'` 后：

```
error TS2345: Argument of type '(...)[]' is not assignable to parameter of type
'(...)[] & { readonly missingKeys: "writeState"; }'.
```

已迁移：`control.contracts.ts` **17 处 → 0 处**。覆盖全部控制线 payload：
`ControlApplyAck`、`ControlOperationAck`、`ControlSnapshot`、`ControlIntent`、
`ControlSubmitRequest`、`ControlMutation`、`ControlOperationRequest/Intent`、
`ControlFieldState`、`MediaTarget`、`ControlError`、`VideoFilterState`、
`ControlActualContext`、`ABLoopState`、`ControlAudioVolumeProjection`、
`ControlReadRequest/Result`。

### M2 棘轮门禁：存量只降不升（已落地）

`scripts/verify/check-contract-key-sets.ts` + `contract-key-set-baseline.json`：

- 新文件或新增手写集合 → 该检查失败（并提示改用 `keySetOf<T>()`）；
- 数量低于基线 → 警告，要求收紧基线（防止基线变成永久豁免）；
- 控制线契约当前为 0，任何回退都会被拦。

已注册进 `verify-architecture`，随 pre-push 的 `verify-architecture` 执行。

### M3 投影从"人工枚举"改为"计算 + 差集"（部分落地，待完成）

已落地的三条守卫（都在 `test/sync-public.spec.ts`）：

| 守卫 | 断言 |
|---|---|
| 类型包投影 | `src` 里每个第三方导入，若仓库声明了 `@types/x`，则必须被投影 |
| 运行时资产投影 | allowlisted 脚本里引用的每个 `./*.json\|csv\|md\|txt` 必须在资产清单 |
| 执行脚本投影 | 公开包脚本命令里出现的每个 `scripts/*.ts` 必须在脚本清单 |

待完成（阶段三）：把三份清单改为**计算产物**——从包脚本命令、import 闭包、
运行时字面量、依赖声明推导出所需集合，人工清单只保留"显式排除"。
门禁改为比对"计算集合"与"投影结果"，而非比对两份人工清单。

### M4 门禁前移与边界化（部分落地，待完成）

已落地：`unit-tests` 进 pre-push（SPECTRA 118 文件 + HALO 441 条，14s）。

待完成：

1. `sync-public` 拆成 **plan（计算 + 在临时目录完整构建）** 与 **apply（推送）**。
   plan 在 PR/push 上跑，apply 保持手动。这样"投影能否构建"不再是发布时才知道；
2. 为每个线端 payload 类型建立**一条最大填充 fixture**，放进契约测试，
   由 `isXxx` 整体校验（今日已为 `ControlApplyAck` 建立）；
3. 逐步把 source-scanning 门禁改为断言行为（能用导入/执行表达的，不用正则）。

## 4. 模块调整与改造范围

| 模块 | 调整 | 状态 | 风险 |
|---|---|---|---|
| `packages/contracts/src/key-set.ts` | 新增绑定原语 | 已落地 | 低（纯函数，无运行时副作用） |
| `packages/contracts/src/control.contracts.ts` | 17 处键集合改为绑定；`writeState` 入列 | 已落地 | 低（运行时语义不变：集合内容等价） |
| `packages/contracts/src/{audio,audio-processor,capture-admission,media-route,settings,settings-ui}.contracts.ts`、`spectra.protocol-primitives.ts` | 剩余 35 处按同一模式迁移 | 待办（阶段二） | 中：需逐个确认类型参数与并集语义 |
| `packages/contracts/src/spectra.protocol.ts` | 148 个动作的响应映射审计；为动作分组建立 fixture | 待办（阶段二） | 中 |
| `nexus/scripts/verify/check-contract-key-sets.ts` + 基线 | 新增棘轮门禁 | 已落地 | 低 |
| `nexus/scripts/verify/check-spectra-control.ts` | 提取器兼容两种声明写法 | 已落地 | 低（消除误报） |
| `nexus/scripts/sync-public.ts` | 三份清单改为计算 + 显式排除 | 待办（阶段三） | 高：触及发布路径，需 plan 先跑 |
| `.github/workflows/sync-public.yml` | 新增 PR 触发的 plan 作业 | 待办（阶段三） | 中：需要临时目录构建预算 |
| `lefthook.yml` | 已有 `unit-tests`、`verify-architecture`；不新增 | 已覆盖 | 低 |
| `apps/extension-spectra/test/*` | 两条线端契约守卫 + 三条投影守卫 | 已落地 | 低 |

改造边界（明确不做）：不引入运行时 schema 库（zod/valibot）替换现有校验器；
不合并校验层与类型层（保持 `@nexus/contracts` 零依赖）；不改协议版本。

## 5. 预期效果

| 指标 | 改造前 | 改造后 |
|---|---|---|
| 新增字段漏同步键集合 | 可运行、线上判定非法 | **编译失败并点名缺键**（已实测） |
| 新增构建脚本漏投影 | 发布时才失败 | pre-push 失败（已实测 3 条守卫） |
| 控制线 payload 的键集合手写点 | 17 | **0** |
| 全仓手写键集合 | 49 | 35，且只能降 |
| 端到端 ACK 校验 | 无 | 执行器产出必须通过 `isControlApplyAck` |
| 公开镜像可构建性 | 三个月不可完成 | 369 文件 + lint + typecheck + build 全过 |

定性效果：**"记得同步"从人的责任变成类型系统的责任。**

## 6. 需要验证的关键点

| 关键点 | 验证方式 | 当前状态 |
|---|---|---|
| 漏键确实编不过 | 变异测试：删 `'writeState'` → `tsc` 报 `missingKeys: "writeState"` | 已验证 |
| 集合内容未改变运行时语义 | 118 文件 + 441 条单测全绿；smoke 从 3/10 → 9/10 | 已验证 |
| 线端整体校验能抓到非法 payload | 最大填充 fixture（含 `writeState`/`restoreBaseline`/`audioVolume`）+ 未知键必须被拒 | 已验证 |
| 投影守卫能抓到缺项 | 三条守卫分别对应今天的三处缺口 | 已验证（守卫先于修复存在时会红） |
| 棘轮不误伤存量 | `verify` 在基线 35 处下通过 | 已验证 |
| **剩余 35 处迁移的等价性** | 逐个文件跑 contracts 测试 + 对比迁移前后集合内容 | **未验证（阶段二）** |
| **plan/apply 拆分后发布路径不变** | 在临时目录跑 plan，对比 apply 的产物哈希 | **未验证（阶段三）** |
| 门禁改为行为断言后覆盖不下降 | 每改一条 source-scanning 检查，补一条对应行为测试 | **未验证（阶段四）** |

## 7. 失效条件（出现即重审，不打补丁）

1. 协议改用运行时 schema 生成校验时，`keySetOf` 应**退役**而不是叠加；
2. 需要按"部分键"校验（例如只允许子集）时，绑定模型不成立，需引入显式子集类型；
3. 投影出现"必须人工判断才能决定是否公开"的文件时，计算模型需引入审批清单，
   而不是继续扩大自动推导；
4. 若某类 payload 的键集合按环境变化（不同 Chrome 版本字段不同），
   编译期绑定不成立，需改为版本化契约。

## 8. 落地顺序

1. **阶段一（已完成）**：`keySetOf` + 控制线 17 处 + 棘轮门禁 + 线端 fixture + 投影三守卫；
2. **阶段二**：剩余 35 处迁移；`spectra.protocol.ts` 响应映射审计与分组 fixture；
3. **阶段三**：投影 plan/apply 拆分，plan 进 CI；
4. **阶段四**：source-scanning 门禁逐条行为化。

阶段二/三的收益是"防同类复发"，阶段一已经消掉今天两起缺陷的**成因**，
但不修复它们造成的**行为残留**——见下节。

## 9. 本方案不解决的问题（明确边界）

- **popup 静音路径 1 条 smoke 未通过**：点静音后页面侧 `mediaMuted` 仍为 false。
  这是行为缺陷，不是一致性问题；对照实验已确认与本次修复无关，需单独定位。
- **音量路径的 Chrome workload 未注册**：可观测性已打通，但未被自动采样证明。
- **Options 与 Popup 两套颜色 token**：产品视觉决策，非架构缺陷。
