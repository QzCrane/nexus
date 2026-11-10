---
type: reference
status: stable
audience: developer
last_reviewed: 2026-11-09
---

# 04. Algorithm Matrix (index)

> 本文件是算法矩阵的**唯一入口**。`§8` 完整控制算法矩阵(51 capabilities)和
> `§9` 已审计源算法(ALG-001..050)按 progressive disclosure 拆分到子文件,
> AI / 人类可按需加载。
>
> 引用规则: 此文件**仅**做章节映射,不再持有任何规范内容。新增算法行只允许
> 落在子文件 + 此处索引中,不在此重复内容。

## 主题索引

| § | 文件 | 主题 |
|---|------|------|
| §8 | [04a-algorithm-matrix.md](04a-algorithm-matrix.md) | 51 capabilities 完整矩阵:persistent + momentary + adjudication mirror + hotkey mapping |
| §9 | [04b-source-algorithms.md](04b-source-algorithms.md) | 50 audited source algorithms (ALG-001..050) and dispositions |

## 数字

- **51 contract capabilities** = 15 native-only + 8 hybrid-extension-native + 26 augmentation-only + 2 observation-only
- **28 persistent snapshot fields + 23 momentary operations**
- **50 source algorithms** (`ALG-001..ALG-050`)
- **静态不变量**: 编号从 `SCTRL-001` 起连续，总数与终点编号由
  [08-invariants-and-gates.md](08-invariants-and-gates.md) 与
  `scripts/verify/check-spectra-control.ts` 共同定义。本文不手写数字——手写的数字
  曾经三次落后于真实条目（44 / 50 / 58），因此这里只保留引用。

## 上下游

- **上级 owner**: [`README.md`](README.md)
- **同级 owner** (本应用内):
  - [`02-strategy-and-routes.md`](02-strategy-and-routes.md) — Strategy order & site route registry
  - [`03-ui-and-boundaries.md`](03-ui-and-boundaries.md) — UI / surface action normalization
  - [`05-control-state.md`](05-control-state.md) — FieldState, echo correlation, volume/mute
  - [`07-runtime-and-performance.md`](07-runtime-and-performance.md) — Implementation status ledger
- **下级实现（契约）**: `packages/contracts/src/control.contracts.ts`
- **下级实现（运行时）**: `src/background/control-coordinator.ts` · `src/background/control-coordinator-values.ts` · `src/content/logic/native-media-async.ts` · `src/content/logic/native-media-executor.ts`
- **静态校验**: `scripts/verify/check-spectra-control.ts`（强制全部 `SCTRL` 编号、51 capabilities 与 50 algorithms 存在；数量以校验器常量为唯一来源）
