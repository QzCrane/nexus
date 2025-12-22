# 策略决策 (v3.2)

## 决策表

| 高级需求 | 受限 |      模式       | 色  |
| :------: | :--: | :-------------: | :-: |
|    ❌    | 任意 |   NATIVE_LITE   | 🔵  |
|    ✅    |  ❌  | NATIVE_WEBAUDIO | 🔵  |
|    ✅    |  ✅  |     CAPTURE     | 🟣  |

## 高级需求

`volume>100 || visualizer || EQ非零 || compressor || bass`

## 模式

| 模式            | 说明          | CPU  |
| --------------- | ------------- | ---- |
| NATIVE_LITE     | DOM 控 0-100% | 极低 |
| NATIVE_WEBAUDIO | WebAudio 链   | 中   |
| CAPTURE         | Tab Capture   | 高   |

## CORS 检测

```text
页面加载 → initCorsStatus() 查表
    │
已检测? → 用缓存
    │ 否
WebAudioController.attachNode()
    │
成功 → SAFE → 入表
失败 → RESTRICTED → 入表 (后续成功可覆盖)
```

## 实现位置

- PolicyEngine: `packages/features/audio-engine/src/PolicyEngine.ts`
- CORS 检测: `content/policy-executor/cors-handler.ts`

## 相关

- 数据流: `docs/cors-data-flow.md`
