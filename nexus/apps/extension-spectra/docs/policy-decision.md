# 策略决策 (v3.5)

## 延迟激活 (v3.5 新增)

**核心原则**：未操作 + 音量正常 → 不启动高级模式，节省 CPU

```text
用户未交互 AND 音量 ≤ 100% → NATIVE_LITE (即使站点需要劫持)
用户打开 Popup 或快捷键 → 正常策略生效
```

## 决策表

| 已交互 | 高级需求 | 受限 |      模式       | 色  |
| :----: | :------: | :--: | :-------------: | :-: |
|   ❌   |   任意   | 任意 |   NATIVE_LITE   | 🔵  |
|   ✅   |    ❌    | 任意 |   NATIVE_LITE   | 🔵  |
|   ✅   |    ✅    |  ❌  | NATIVE_WEBAUDIO | 🔵  |
|   ✅   |    ✅    |  ✅  |     CAPTURE     | 🟣  |

## 高级需求

`volume>100 || visualizer || EQ非零 || compressor || bass`

## 模式

| 模式            | 说明          | CPU  |
| --------------- | ------------- | ---- |
| NATIVE_LITE     | DOM 控 0-100% | 极低 |
| NATIVE_WEBAUDIO | WebAudio 链   | 中   |
| CAPTURE         | Tab Capture   | 高   |

## CORS 检测 (v3.4)

使用 `AnalyserNode.getByteFrequencyData()` 读取数据判断：

- 有数据 → SAFE
- 全零 → RESTRICTED

详见: `docs/cors-data-flow.md`

## 实现位置

- PolicyEngine: `packages/features/audio-engine/src/PolicyEngine.ts`
- CORS 检测: `content/policy-executor/cors-handler.ts`
