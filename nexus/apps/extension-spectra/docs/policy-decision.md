# Extension SPECTRA 策略决策表 (v3.0 极简版)

> 零维护、零 URL 分析、纯行为检测

## 核心原则

> 最大化省 CPU，最小化维护成本

## 决策表

|  #  | 高级需求 | 受限站点 |       模式        | 颜色  |
| :-: | :------: | :------: | :---------------: | :---: |
|  1  |    ❌    |   任意   |   `NATIVE_LITE`   | 🔵 蓝 |
|  2  |    ✅    |    ❌    | `NATIVE_WEBAUDIO` | 🔵 蓝 |
|  3  |    ✅    |    ✅    |     `CAPTURE`     | 🟣 紫 |

## 高级需求定义

```typescript
const needsAdvanced =
  volume > 100 || // 超过原生上限
  visualizerEnabled || // 频谱开
  eqValues.some((v) => v !== 0) || // EQ 非零
  compressor || // 压缩器
  bass; // 低音增强
```

## 模式说明

| 模式              | 说明             | CPU  |
| ----------------- | ---------------- | ---- |
| `NATIVE_LITE`     | DOM 控 0-100%    | 极低 |
| `NATIVE_WEBAUDIO` | WebAudio 处理链  | 中   |
| `CAPTURE`         | Tab Capture 劫持 | 高   |

## 决策流程图

```text
         ┌─────────────────┐
         │  有高级需求?     │
         └────────┬────────┘
                  │
       ┌──────────┴──────────┐
      ❌ 否                 ✅ 是
       ↓                      ↓
  NATIVE_LITE        ┌───────────────┐
   (最省CPU)         │  受限站点?    │
                     └───────┬───────┘
                   ┌─────────┴─────────┐
                  ❌ 否              ✅ 是
                   ↓                   ↓
            NATIVE_WEBAUDIO        CAPTURE
```

## v3.0 变更

**删除**：

- 播放页/预览页区分 → 用"高级需求"代替
- URL 参数/路径分析 → 完全不需要
- userInteracted 标志 → 用"高级需求"代替
- 站点路径规则 → 完全不需要

**保留**：

- 受限站点列表 (CORS 无法运行时检测)
- 用户自定义受限列表

## 实现位置

- **PolicyEngine**: `packages/features/audio-engine/src/PolicyEngine.ts`
