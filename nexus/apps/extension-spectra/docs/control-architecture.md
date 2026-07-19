---
type: reference
status: stable
audience: developer
---

# SPECTRA control architecture (index)

> 本文件是 SPECTRA 控制的**唯一入口**。所有主题 owner 在 `control/` 子目录,
> 按 progressive disclosure 拆分,AI/人类可按需加载。
>
> 引用规则: 此文件**仅**做章节映射,不再持有任何规范内容。新增主题只允许
> 落在子文件 + 此处索引中,不在此重复内容。

## 主题索引

| # | 文件 | 主题 |
|---|------|------|
| 01 | [control/01-foundations.md](control/01-foundations.md) | Product semantics · Control flow and state ownership |
| 02 | [control/02-strategy-and-routes.md](control/02-strategy-and-routes.md) | Strategy order · Site route registry · Runtime ownership · Site adapters, PiP & fullscreen |
| 03 | [control/03-ui-and-boundaries.md](control/03-ui-and-boundaries.md) | UI/visualizer/favicon/remote boundaries · User experience |
| 04 | [control/04-algorithm-matrix.md](control/04-algorithm-matrix.md) | Complete control algorithm matrix · Audited source algorithms & dispositions |
| 05 | [control/05-control-state.md](control/05-control-state.md) | Control state (FieldState, echo correlation, processor handoff) · Volume/mute · Audio processing (DSP) |
| 06 | [control/06-media-and-video.md](control/06-media-and-video.md) | Active media (target) · Media controls · Video effects & screenshot |
| 07 | [control/07-runtime-and-performance.md](control/07-runtime-and-performance.md) | Runtime loading & performance · Implementation ownership & migration map · Cross-world site adapters |
| 08 | [control/08-invariants-and-gates.md](control/08-invariants-and-gates.md) | Static invariants (SCTRL-001..044) · Migration and release gate |

## 数字

- **51 contract capabilities** = 17 native-only + 6 hybrid-extension-native + 26 augmentation-only + 2 observation-only
- **28 persistent snapshot fields + 23 momentary operations**
- **50 source algorithms** (`ALG-001..ALG-050`)
- **44 static invariants** (`SCTRL-001..SCTRL-044`)

## 上下游

- **上级 owner**: [`/AGENTS.md`](../../../../../AGENTS.md) · [`/nexus/docs/engineering-principles.md`](../../../../docs/engineering-principles.md) §3 EPR
- **同级 owner** (本应用内):
  - [`architecture.md`](architecture.md) — Runtime context 所有权 + 加载拓扑
  - [`protocols.md`](protocols.md) — 跨上下文 state/message/lease 协议
  - [`remote-security.md`](remote-security.md) — 远程配对 + HMAC + offscreen
  - [`cors-data-flow.md`](cors-data-flow.md) — 不可逆 WebAudio 绑定前的来源准入
- **下级实现**: `packages/contracts/src/control.contracts.ts` · `src/background/control-coordinator.ts` · `src/content/logic/native-media-executor.ts`
- **静态校验**: `scripts/verify/check-spectra-control.js` (强制 44 invariants + 51 capabilities + 50 algorithms 全部存在)

## 历史与归档

- `_archive/2026-Q3/` 历史快照(2026-Q3 release 与 regression 证据)非当前 owner。
- 详细 ALG → location 映射、retired writers 与 capability decision 见 [control/04-algorithm-matrix.md](control/04-algorithm-matrix.md) 与 [control/07-runtime-and-performance.md](control/07-runtime-and-performance.md)。
