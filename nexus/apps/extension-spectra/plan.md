# SPECTRA 规划

> 定位: 专业浏览器音频/视频控制中心

## 阶段 1: 核心控制 (v1.0) ✅

AudioEngine: 音量 800% | 31 段 EQ | 动态压缩 | 声道平衡/3D 环绕 | AudioContext 劫持
VideoControl: 变速 0.1x-16x | 旋转/镜像/缩放 | 亮度/对比度/饱和度 | PiP

## 阶段 2: 体验升级 (v1.1) 🚧

交互: ✅ 右键菜单预设 | ✅ 键盘快捷键 (Global/OSD) | ✅ 平滑滚动 (Boundary bubbled) | 媒体嗅探列表
集成: SponsorBlock(跳过推广) | Lyrics Sync(字幕同步)
性能: ✅ Zero-Allocation (Loop/Audio/Capture) | ✅ O(N) Frequency Scan

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

### 2026-02-21: Enhanced Preset Management + Unified Version

**功能**: 预设管理增强 + 版本统一管理

**预设管理**:

- Global/Site 双层级预设系统
- 搜索过滤功能
- 默认预设标记
- 应用(✓)/预览(👁)/默认(★)/删除(✕) 操作
- 音量(蓝色)/速度(橙色) 高亮显示
- 水平紧凑布局

**版本管理**:

- package.json 作为唯一版本源 (SSOT)
- build.mjs 构建时自动同步到 popup.html 和 manifest.json
- 开发构建显示 `v{x.x.x} • Dev`，生产构建显示 `v{x.x.x} • Prod`

**技术**:

- Playback Rate Hijack (原型劫持实现双向同步)
- 性能优化 (Bit Flags, Object Pooling, Loop Unrolling)

+

+### 2026-02-25: Site-Bridge Refactoring & YouTube Fixes
+
+**重构**: 实现 Pinnacle Site-Bridge 架构
+
+**目标**: 彻底解耦 core logic 与特定站点逻辑，消除 YouTube 变速/音量冲突。
+
+**修复**:
+1. **YouTube 倍速锁定**: 引入 `shouldInhibitDomSync` 拦截 DOM 暴力修改，解决 SPA 路由切换导致的倍速重置 Bug。
+2. **Boost Guard 升级**: 修复收到的 100% 权威报告覆盖插件 >100% 增益状态的问题。
+3. **Speed Persistence Guard**: 识别视频加载及广告切换时的 programmatic 1.0x 重置，强制维持用户设定。
+4. **架构升级**: 删除 `youtube-adapter.ts`，由 `Registry` 模式动态加载 `YouTubeBridge`。
+
+**状态**: 已随 v1.3.2 发布。
