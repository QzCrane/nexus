# SPECTRA 扩展规划 (Roadmap)

> **定位**: 专业的浏览器音频/视频控制中心

## 📅 阶段 1: 核心控制 (v1.0) [✅ 已完成]

### 音频引擎 (AudioEngine)

- [x] 音量增强 (up to 800%)
- [x] 31 段图示均衡器 (EQ)
- [x] 动态压缩 (Limiter)
- [x] 声道平衡 / 3D 环绕
- [x] AudioContext 劫持 (接管 WebAudio 流量)

### 视频控制

- [x] 变速播放 (0.1x - 16x)
- [x] 画面变换 (旋转, 镜像, 缩放)
- [x] 滤镜调节 (亮度, 对比度, 饱和度)
- [x] 画中画 (PiP)

---

## 📅 阶段 2: 体验升级 (v1.1) [🚧 进行中]

### 交互优化

- [x] 右键菜单快捷预设
- [ ] 键盘快捷键自定义
- [ ] 媒体资源的自动嗅探与列表展示

### 第三方集成

- [ ] **SponsorBlock**: 自动跳过 YouTube 推广片段
- [ ] **Lyrics Sync**: 字幕/歌词同步显示 (Overlay)

---

## 📅 阶段 3: 本地 AI (Moat) [🔜 待启动]

> **策略**: 端侧推理 (On-Device AI), 保护隐私

### 智能音频

- [ ] **人声分离 (Vocal Remover)**: 基于 WASM + ONNX Runtime (U-Net)
- [ ] **听歌识曲**: 本地指纹库或 ACRCloud 集成
- [ ] **语音增强**: 降噪与清晰度提升

### 智能转录

- [ ] **实时 STT**: 使用 Whisper-tiny (WASM) 进行本地语音转文字
- [ ] **双语对照**: 结合翻译 API 提供实时双语字幕

---

## 🔗 关联文档

- [决策记录](docs/policy-decision.md)
- [数据流图](../../docs/cors-data-flow.md)
