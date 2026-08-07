---
type: reference
status: stable
audience: developer
last_reviewed: 2026-08-08
---

# 05. Control state (Field states, volume/mute, audio processing)

> 主题 owner 段: §10 Control state · §11 Volume and mute · §12 Audio processing
> 完整目录: [README.md](README.md)

## §10 Control state

`ControlCoordinator` 负责意图排序与快照权威。全字段绑定 `tabId + documentId + generation + revision + intentId`:

```ts
interface ControlFieldState<T> {
  desired: T | null;
  actual: T | null;
  restoreBaseline?: T;
  revision: number;
  phase: 'idle' | 'applying' | 'applied' | 'error';
  strategy: 'observe' | 'page-native' | 'dom-native' | 'chrome-native' | 'extension-state' | 'extension-css' | 'extension-overlay' | 'media-webaudio' | 'capture' | 'unsupported';
  coverage: 'full' | 'active-target' | 'partial' | 'opaque';
  controlled: boolean;
  intentId?: string;
  lastError: ControlError | null;
}
```

- **Echo Correlation Token**: `{ intentId, fieldRevision, expectedValue, tolerance }`（禁止时间窗口布尔标记）。
- **Processor Handoff (Media WebAudio ↔ Capture)**: 无双重增益/DSP，无虚假 active ACK。Media WebAudio → Capture 必须先 ACK 中性路由，在闭合 gate 下构建 Capture 图，验证通过后方可切换 `actualMode=capture`。

## §11 Volume and mute

```text
volumeBase = 0..100
boost = 1..8
AudioConfig.volume = clamp(volumeBase * boost, 0, 800)
effective output ~= volumeBase / 100 * boost
```

- **分层分配**: `0–100` 仅写原生 `volumeBase` (`boost=1`)；`100–800` 固定 `volumeBase=100` 仅写隐式 `boost`；跨越 100% 边界在单控制事务内同时写入两者。
- **Mute**: 仅修改原生静音属性，保持数值音量与处理器 DSP 状态不变。
- **无隐式 Limiter**: 禁用隐式限幅器，Compressor 为独立显式能力。

## §12 Audio processing

具备安全跨域/同源能力的全局媒体走 Media WebAudio（单文档共享图）；存在任一不安全/不透明源时切换至 Capture。不可逆绑定后的 WebAudio 生命周期为 `page-lifetime-after-media-binding`（释放后保留 the smallest source -> gain -> destination route until navigation 最小中性路由）。

### §12.1 Media WebAudio complete-coverage admission

1. `assessMediaSourceCoverage`: 评估所有注册媒体元素，全合规方可允许 `fullCoverage`。
2. `WebAudioController.ensureAttached`: 确认每个元素具备唯一 `MediaElementSourceNode`。
3. `hasCompleteCoverage`: 确认每一个 Prospective Safe 元素已实际连接至 Shared Router。

### §12.2 DSP 节点与精确参数

```text
sources -> mix bus -> master gain -> [Bass] -> [non-zero EQ] -> [Compressor] -> [Mono] -> [Pan] -> [Delay] -> output (+ optional analyser)
```

| Algorithm | Exact definition |
| --- | --- |
| Boost | 线性 master `boostGain` `1–8`（无 0 增益代换与隐式限幅） |
| 10-band EQ | peaking filters at `32/64/125/250/500/1000/2000/4000/8000/16000Hz`, `Q=1.4`, gain `-12..+12dB` |
| Bass | `lowshelf`, `200Hz`, `+10dB` |
| Compressor | threshold `-24dB`, knee `30dB`, ratio `12:1`, attack `0.003s`, release `0.25s` |
| Mono | `M=0.5L+0.5R`, `L'=M`, `R'=M` |
| Pan | `StereoPanner`, `-1..1` |
| Delay | `0–500ms`, 100% wet |
| Visualizer | 显式订阅才分配主 Tap, `fftSize=256`/128 byte bins |