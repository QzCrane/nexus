---
type: explanation
status: draft
audience: contributor
owner: spectra
last_reviewed: 2026-10-28
---

# SPECTRA 音量条不跟手：根因与延迟预算

「拖动音量条时填充与数字落后于手指」被反复报告了两次。第一次（2026-09-23）诊断为
100–110 边界处的显示停滞，只修了触发条件；2026-10-28 再次报告并定位到真正的取值缺陷。
本文记录完整的因果链、每一毫秒的归属、以及哪些延迟是物理下限。

## 1. 结论先说

| 你看到的 | 性质 | 修复前 | 修复后 |
|---|---|---|---|
| 填充条/数字跟随手指 | 架构缺陷 | 跨过 100 后**整段冻结** | ≤ 16.7ms（一帧） |
| 显示的值是否真实 | 设计权衡 | 阻塞 97ms | 移出关键路径 |
| 声音实际变化 | 物理必然 | — | ~20–30ms（音频缓冲） |

**主要症状不是「慢」，是「不动」。** 这不是延迟预算问题，是取值来源错误。

## 2. 三个独立缺陷

| # | 缺陷 | 机制 | 状态 |
|---|---|---|---|
| 1 | 数值冻结 | `resolveVolumePresentation` 取 `presentation?.effectiveVolume ?? ...`，只要 `pendingVolumePresentation` 存在就返回手势起始值 | 2026-10-28 修复 |
| 2 | 投影多写者 | `render.ts` 与 `events.ts` 同时写 fill / value / slider，后写者静默获胜，表现为抖动与落后一手势 | 2026-10-28 收敛为单写者 `volumeView` |
| 3 | 验证阻塞关键路径 | `NATIVE_EVENT_QUIET_MS = 64` + 2×rAF ≈ 97ms 被当作作答前置条件 | 移出关键路径（非删除） |

### 2.1 为什么第一次没修好

09-23 的修复只改了**冻结的触发条件**（从「每次拖动」收窄到「跨 100 边界或 mute 同批变化」），
没有改**冻结时取什么值**。滑块范围是 0–800，日常拖动必然跨过 100；
一旦跨越，`??=` 使 pending 不再更新，剩余整段拖动全部冻结在起始值。

**这就是「同区间拖动已修好、跨边界完全不动」的原因，也是症状看起来一直存在的原因。**
治标的改动会通过测试并伪装成完成——测试断言的是「pending 已建立」，
而不是「显示值跟随指针」。

## 3. 延迟预算：每一毫秒的归属

| 项 | 量级 | 归属 | 能否消除 |
|---|---|---|---|
| 一帧 | 16.7ms @60Hz | 显示器刷新物理 | 否 |
| 音频输出缓冲 | ~20–30ms（估算 10–30ms） | 音频 DSP 缓冲，浏览器/硬件决定 | 否 |
| IPC 往返 | 1–3ms | popup 与页面是不同文档 | 否（MV3 架构） |
| SW 冷启动 | 数十 ms | MV3 worker 可被随时终止 | 否（平台设计） |
| 路由切换（>100、capture） | 异步 | 启动 WebAudio 处理器无法同步完成 | 否（功能代价） |
| 验证静默窗口 | 97ms | `NATIVE_EVENT_QUIET_MS` 64 + 2×rAF | 已移出关键路径 |

视觉下限 16.7ms 与听觉下限 ~20ms 是**任何实现**（包括 Chrome 原生音量控制）都跨不过的。
把这两项从「感知延迟」里剔除后，剩余部分全部是代码问题。

## 4. 修复

数值永远实时；`pendingVolumePresentation` 只管辖色调与静音状态：

```ts
const effectiveVolume = resolveAudioVolume(state.config).effectiveVolume;   // 永远实时
color: actualVolumeColor(
  presentation?.muted ?? state.config.muted,
  effectiveVolume,
  presentation?.actualMode ?? state.actualMode,   // 色调仍等路由 ACK
  presentation?.phase ?? state.phase,
)
```

这与 [03 UI and boundaries](../../apps/extension-spectra/docs/control/03-ui-and-boundaries.md)
的颜色语义一致：颜色是**确认后的用户结果**的函数。数值不需要确认即可显示，
色调需要——所以只有色调等待 ACK。

`events.ts` 的 `paintPointer` 改为无条件调用（两条路径现在一致），仅在静音时跳过，
避免 `110%` 与 `MUTE` 每帧闪烁。

## 5. 证据

| 项 | 结果 |
|---|---|
| `test/popup-volume-view.spec.ts`（新增） | 6 条：单写者 commit / paintPointer / setThumb、等值守卫只抑制抖动不吞真实变化、边界钳制、muted 优先、非有限值忽略 |
| `test/popup-coalescing.spec.ts` | 新增跨边界拖动序列 `90 → 110 → 240 → 480 → 700`，**逐步断言跟手**，并断言 pending 仍存在、色调仍受保护 |
| 语义保留 | 4 处既有断言的数值改为实时，**颜色断言一字未改** |
| `test:unit` | 117/117 文件通过 |
| typecheck / biome / build / verify | 全部 0 错误 |

**渲染层此前零覆盖**，这是同一个症状能反复出现的根本原因：缺陷在渲染层，
测试却只覆盖状态层，于是「状态对了」被当成「显示对了」。

## 6. 仍未闭环

没有真实浏览器端的端到端延迟采样。上表的 97ms、16.7ms 是代码推导，
不是测量值。content 侧遥测尚未接入 `background/diagnostics.ts`，
`runtime-performance-policy.json` 也没有对应 workload——详见
[架构审计未决项](2026-10-26-spectra-architecture-audit.md) 第 8 节第 1 条。

## 7. 可复用的教训

> **改「何时冻结」不等于改「冻结时取什么值」。**

只动触发条件时，测试全绿、症状部分消失，看起来像修好了。
判断一个修复是否治本，标准不是「测试过了」，而是「症状的定义被消除了吗」——
本例中症状是「显示值不等于指针值」，那么断言就必须比较这两个值。
