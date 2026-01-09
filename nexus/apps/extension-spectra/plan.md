# SPECTRA 规划

> 定位: 专业浏览器音频/视频控制中心

## 阶段 1: 核心控制 (v1.0) ✅

AudioEngine: 音量 800% | 31 段 EQ | 动态压缩 | 声道平衡/3D 环绕 | AudioContext 劫持
VideoControl: 变速 0.1x-16x | 旋转/镜像/缩放 | 亮度/对比度/饱和度 | PiP

## 阶段 2: 体验升级 (v1.1) 🚧

交互: ✅ 右键菜单预设 | ✅ 键盘快捷键 (Global/OSD) | ✅ 平滑滚动 (Boundary bubbled) | 媒体嗅探列表
集成: SponsorBlock(跳过推广) | Lyrics Sync(字幕同步)

## 阶段 3: 本地 AI (Moat) 🔜

策略: 端侧 WASM 推理，保护隐私
智能音频: 人声分离(ONNX U-Net) | 听歌识曲(指纹库/ACRCloud) | 语音降噪增强
智能转录: Whisper-tiny 实时 STT | 双语对照字幕

## 关联

[决策记录](docs/policy-decision.md) | [协议](docs/protocols.md) | [CORS 数据流](docs/cors-data-flow.md)

---

## 变更记录

### 2026-01-08: Fix YouTube Fullscreen Freeze

**问题**: NATIVE_WEBAUDIO 模式下 YouTube 大音量全屏时视频/音频冻结

**根因**: `media-observer.ts` 中 MutationObserver 的 `removedNodes` 回调在 YouTube 全屏 DOM 重组时误调用 `detachNode()`，导致 `createMediaElementSource()` 绑定断裂

**修复**: 移除 removedNodes → detachNode 逻辑

### 2026-01-09: Fix Default-Muted Video Sites (Bilibili)

**问题**: 打开 bilibili 主页时，插件会被自动静音，导航到视频后仍保持静音

**根因**: bilibili 主页视频默认 `muted=true`，触发 `volumechange` 事件被 `volume-observer.ts` 同步到插件 config，错误持久化为用户意图

**修复**:

1. `volume-observer.ts` 引入 `hasReceivedUserEvent` 标志，区分"页面初始化"和"用户操作"
2. `core/lifecycle/user-interaction.ts` 的 `syncDomVolumeToState()` 移除对 muted 状态的同步，只同步 volume 用于 UI 显示
