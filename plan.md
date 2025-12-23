# Project NEXUS 实施方案

## 概览

**三驾马车**: SPECTRA(声光/Popup) + CORTEX(大脑/SidePanel) + HALO(结界/SidePanel)

## 产品功能矩阵

### SPECTRA - 专业媒体播放器

| 优先级 | 模块   | 功能                         | 技术      | 商业 |
| :----: | ------ | ---------------------------- | --------- | :--: |
|   P0   | Audio  | 800%音量/10 段 EQ/压限器     | WebAudio  | FREE |
|   P0   | Video  | 旋转/镜像/去黑边/速率/画中画 | CSS+JS    | FREE |
|   P0   | Tool   | 截图/AB 循环/时间标记        | Canvas+JS | FREE |
|   P1   | AI     | 人声分离                     | WASM+ONNX | PRO  |
|   P1   | Remote | 手机遥控                     | WebSocket | FREE |
|   P2   | Audio  | 空间音频/声画同步/声道平衡   | WebAudio  | PRO  |

### CORTEX - AI 信息中心

| 优先级 | 功能                 | 技术             | 商业 |
| :----: | -------------------- | ---------------- | :--: |
|   P1   | 听歌识曲             | ACRCloud         | FREE |
|   P2   | 双语字幕/AI 摘要/OCR | Gemini+Tesseract | PRO  |

### HALO - 极客工具箱

| 优先级 | 功能                        | 技术         |
| :----: | --------------------------- | ------------ |
|   P3   | 命令面板/万年历/番茄钟/冥想 | Fuzzy+Alarms |

## 架构

```text
Apps:    SPECTRA ←→ CORTEX ←→ HALO
            ↓          ↓         ↓
Packages: audio-engine | ai-engine | zen-engine
            ↓          ↓         ↓
Kernel:  [Typed RPC Bus] [Storage Repo] [Cross-Ext Msg]
            ↓
Infra:   rust-core (WASM)
```

**依赖链**: contracts ← kernel ← features ← apps

## 技术选型

| 层   | 技术                        | 用途          |
| ---- | --------------------------- | ------------- |
| 计算 | Rust → WASM + AudioWorklet  | 人声分离/压缩 |
| 通信 | WebSocket + Protobuf        | 手机遥控      |
| 渲染 | React 18 + Zustand + Framer | Side Panel    |

## 实施路线

### Phase 1 ✅ 基础设施

- [x] Monorepo (pnpm+turbo)
- [x] nexus-kernel + audio-engine
- [x] extension-spectra MV3

### Phase 2 🚀 功能扩展 (W1-W2)

**UI 策略**: 原生 TS+HTML，Popup 内下拉控制面板

#### 视频控制 (Content Script 操作)

| ID     | 功能               | 技术                    | 状态 |
| ------ | ------------------ | ----------------------- | :--: |
| 2.1.1  | 旋转 90°/180°/270° | CSS transform           |  ⬜  |
| 2.1.2  | 水平镜像           | CSS scaleX(-1)          |  ⬜  |
| 2.1.3  | 去黑边             | object-fit + 裁剪       |  ⬜  |
| 2.1.4  | 速率控制 0.1x-16x  | playbackRate            |  ⬜  |
| 2.1.5  | 画中画             | requestPictureInPicture |  ⬜  |
| 2.1.6  | 全屏               | requestFullscreen       |  ⬜  |
| 2.1.7  | 暂停/播放          | video.pause/play        |  ⬜  |
| 2.1.8  | 时间跳转 ± 帧/秒   | currentTime             |  ⬜  |
| 2.1.9  | 截图 + 下载        | Canvas drawImage        |  ⬜  |
| 2.1.10 | 时间标记点         | 存储 + 跳转             |  ⬜  |
| 2.1.11 | AB 循环            | 区间重复播放            |  ⬜  |

#### 音频控制 (已有基础扩展)

| ID    | 功能         | 技术                 | 状态 |
| ----- | ------------ | -------------------- | :--: |
| 2.2.1 | 声道平衡     | StereoPannerNode     |  ⬜  |
| 2.2.2 | 声画同步延迟 | DelayNode ±500ms     |  ⬜  |
| 2.2.3 | 变速变调     | playbackRate + pitch |  ⬜  |

#### 视觉滤镜 (FX)

| ID    | 功能               | 技术       | 状态 |
| ----- | ------------------ | ---------- | :--: |
| 2.3.1 | 亮度/对比度/饱和度 | CSS filter |  ⬜  |
| 2.3.2 | 灰度/反色          | CSS filter |  ⬜  |
| 2.3.3 | 背景变暗           | 遮罩层     |  ⬜  |

#### 其他

| ID    | 功能           | 技术        | 状态 |
| ----- | -------------- | ----------- | :--: |
| 2.4.1 | 切回后台标签页 | chrome.tabs |  ⬜  |
| 2.4.2 | 热键编辑器     | 配置面板    |  ⬜  |
| 2.4.3 | URL 规则条件   | 域名配置    |  ⬜  |

### Phase 3 🛡️ WASM 壁垒 (W3-W6)

- [ ] rust-core 初始化
- [ ] AudioWorklet 集成
- [ ] ONNX 人声分离

### Phase 4 🔮 生态扩展

- [ ] CORTEX / HALO Side Panel
- [ ] 跨插件 NEXUS Bus
