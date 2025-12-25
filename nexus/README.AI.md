# NEXUS Project Map

**Architecture**: `@contracts (Types) ← @kernel (IPC) ← @features (Logic) ← @apps (Entry)`

## 📦 目录结构

- `packages/contracts`: 纯类型与核心契约。
- `packages/nexus-kernel`: 消息总线 (RPC) + 存储 (Storage) + 统一日志。
- `packages/features/audio-engine`: WebAudio 节点链与模式计算。
- `apps/extension-spectra`: 扩展端实现 (Popup, Content, Background, Offscreen)。

## 🎭 核心功能 (Features)

- **Audio Control**: 10 段 EQ、低音增强、动态压缩、左右平衡、延迟补偿。
- **CORS Detection**: 自动观察 Analyser 状态，智能切换 Capture 模式。
- **Visualizer**: 极简频谱、核心岛动效。
- **UI/UX**: 稳定 Grid 布局、OSD (屏幕提示)、Toast (提示框)、侧边面板。

## 📡 消息速查 (Message Bus)

- `AUDIO_GET/SET`: 音频全量配置。
- `CAPTURE_TOGGLE/GET`: 劫持模式状态切换。
- `UI_SYNC`: 后台与 UI 的实时状态同步。
- `MEDIA_PLAY/SPEED`: 视频播放与倍速控制。
- `VIDEO_ROTATE/FILT`: 画面旋转与 CSS 滤镜。

## ⚖️ 策略矩阵 v3.2

|        有交互        | 有需求 | 受限 |     模式     | 颜色  |
| :------------------: | :----: | :--: | :----------: | :---: |
|          ❌          |  任意  | 任意 |   **LITE**   |  🔵   |
|          ✅          |   ❌   | 任意 |   **LITE**   |  🔵   |
|          ✅          |   ✅   |  ❌  | **WEBAUDIO** |  🔵   |
|          ✅          |   ✅   |  ✅  | **CAPTURE**  |  🟣   |
| \*需求: volume > 100 |   EQ   | comp |     bass     | viz\* |

## 📜 规则索引

- **数据流**: `docs/cors-data-flow.md`
- **决策策略**: `docs/policy-decision.md`
- **压缩规范**: `docs/ai-rules/documentation.md`
