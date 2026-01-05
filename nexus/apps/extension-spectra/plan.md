# SPECTRA 规划

> 定位: 专业浏览器音频/视频控制中心

## 阶段 1: 核心控制 (v1.0) ✅

AudioEngine: 音量 800% | 31 段 EQ | 动态压缩 | 声道平衡/3D 环绕 | AudioContext 劫持
VideoControl: 变速 0.1x-16x | 旋转/镜像/缩放 | 亮度/对比度/饱和度 | PiP

## 阶段 2: 体验升级 (v1.1) 🚧

交互: ✅ 右键菜单预设 | 键盘快捷键自定义 | 媒体嗅探列表
集成: SponsorBlock(跳过推广) | Lyrics Sync(字幕同步)

## 阶段 3: 本地 AI (Moat) 🔜

策略: 端侧 WASM 推理，保护隐私
智能音频: 人声分离(ONNX U-Net) | 听歌识曲(指纹库/ACRCloud) | 语音降噪增强
智能转录: Whisper-tiny 实时 STT | 双语对照字幕

## 关联

[决策记录](docs/policy-decision.md) | [协议](docs/protocols.md) | [CORS 数据流](docs/cors-data-flow.md)
