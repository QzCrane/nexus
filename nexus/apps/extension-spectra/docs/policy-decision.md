# 策略决策

**核心原则**：调节行为或进入劫持才激活增强模式，否则保持 `LITE` 模式以节省资源。

## 决策矩阵

| 有交互 | 有需求 | 受限 |     模式     | 色  |
| :----: | :----: | :--: | :----------: | :-: |
|   ❌   |  任意  | 任意 |   **LITE**   | 🔵  |
|   ✅   |   ❌   | 任意 |   **LITE**   | 🔵  |
|   ✅   |   ✅   |  ❌  | **WEBAUDIO** | 🔵  |
|   ✅   |   ✅   |  ✅  | **CAPTURE**  | 🟣  |

## 触发定义

- **需求 (Needs)**: volume > 100 | EQ | comp | bass | viz
- **交互 (Interacted)**:
  - 手持调节除 `enabled` 外的参数。
  - **劫持即交互**: `isPredictedCapture` 为真（Enabled & Restricted & Needs）自动触发交互状态。

## 模式说明

- **LITE**: DOM 原始控制 (0-100%)。
- **WEBAUDIO**: 页面内 WebAudio 链路。
- **CAPTURE**: Tab Capture 劫持（高 CPU）。
