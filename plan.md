  # 实施方案：Project NEXUS (The Browser OS)

  ## 目标描述

  构建 Chrome 扩展生态的“三驾马车”，统称为 **Project NEXUS**。
  通过 **SPECTRA** (声光)、**CORTEX** (大脑) 和 **HALO** (结界) 建立绝对竞争优势。

---

  ## 0. 三大旗舰产品功能架构 (Product Feature Matrix)

  ### 🎵 SPECTRA (Extension A) - 声光频谱

  **交互形态**: Popup (快进快出)
  **定位**: 把浏览器变成专业媒体播放器

  | 优先级 | 功能模块         | 具体描述                 | 技术实现                    | 商业化    |
  | :----- | :--------------- | :----------------------- | :-------------------------- | :-------- |
  | **P0** | Audio DSP        | 800% 音量增强            | `GainNode`                  | [FREE]    |
  | **P0** | Audio DSP        | 10段均衡器 (EQ)          | `BiquadFilterNode` x10      | [FREE]    |
  | **P0** | Audio DSP        | 动态压限器 (防爆音)      | `DynamicsCompressorNode`    | [FREE]    |
  | **P0** | Video Geometry   | 视频旋转 (躺着看)        | CSS `transform: rotate()`   | [FREE]    |
  | **P0** | Video Geometry   | 视频镜像 (练舞)          | CSS `transform: scaleX(-1)` | [FREE]    |
  | **P0** | Video Geometry   | 去黑边缩放 (21:9适配)    | CSS `object-fit` + Crop     | [FREE]    |
  | **P1** | AI Vocal Remover | 人声/伴奏分离            | **WASM + ONNX Runtime**     | **[PRO]** |
  | **P1** | Mobile Remote    | 手机扫码变遥控器         | **WebSocket Relay**         | [FREE]    |
  | **P2** | Spatial Audio    | 影院级混响/声场扩展      | `ConvolverNode` + IR        | [PRO]     |
  | **P2** | Audio Sync       | 声画同步 (蓝牙延迟修正)  | `DelayNode` (+/- ms)        | [PRO]     |
  | **P2** | Balance          | 左右声道平衡             | `StereoPannerNode`          | [FREE]    |
  | **P3** | Watch Party      | 异地多人同屏观看         | WebSocket 进度同步          | [LAB]     |
  | **P3** | Video Screenshot | 视频截图 (Clean Capture) | Canvas `drawImage()`        | [FREE]    |

---

  ### 🧠 CORTEX (Extension B) - 大脑皮层

  **交互形态**: Side Panel (常驻侧边栏)
  **定位**: AI 第二大脑，信息获取与处理中心

  | 优先级 | 功能模块          | 具体描述                  | 技术实现                           | 商业化       |
  | :----- | :---------------- | :------------------------ | :--------------------------------- | :----------- |
  | **P1** | Music Recognition | 听歌识曲 (识别视频 BGM)   | ACRCloud API + `AudioContext` 采样 | [FREE]       |
  | **P2** | Bilingual Subs    | 双语字幕挂载 (Netflix/YT) | 解析原生 `<track>` 字幕流          | **[PRO]**    |
  | **P2** | Vision Search     | 以图搜图 (识别商品/人物)  | 截图 -> Google Lens/Yandex 跳转    | [FREE]       |
  | **P2** | AI Summary        | 网页/视频内容总结         | Gemini Flash API                   | [FREE/Limit] |
  | **P2** | OCR               | 视频硬字幕提取            | Tesseract.js (离线) 或 Cloud API   | [PRO]        |
  | **P3** | Timestamp Notes   | 时间戳笔记 (点击跳转)     | IndexedDB + n8n Webhook 同步       | [FREE]       |

---

  ### 🔮 HALO (Extension C) - 光环结界

  **交互形态**: Side Panel (常驻侧边栏)
  **定位**: 极客工具箱 + 情绪价值

  | 优先级 | 功能模块        | 具体描述                    | 技术实现                            | 商业化    |
  | :----- | :-------------- | :-------------------------- | :---------------------------------- | :-------- |
  | **P3** | Digital Zen     | 电子木鱼 (敲击解压)         | Canvas 动画 + Web Audio 音效        | [FREE]    |
  | **P3** | Command Palette | 全局命令面板 (Ctrl+Shift+P) | 全局快捷键 + Fuzzy Search (fuse.js) | **[PRO]** |
  | **P3** | Calendar        | 万年历 (农历/节假日)        | 静态 JSON 数据 (chinese-calendar)   | [FREE]    |
  | **P3** | Pomodoro        | 番茄钟                      | `chrome.alarms` API                 | [FREE]    |
  | **P3** | Currency        | 汇率换算                    | 第三方汇率 API (exchangerate-api)   | [FREE]    |
  | **P3** | Breathing       | 呼吸冥想引导                | CSS 动画 + 定时器                   | [FREE]    |

---

  ### 底层技术关系图

  ```text
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                           NEXUS Kernel (共享层)                          │
  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
  │  │  Typed RPC Bus   │  │ Storage Repo     │  │ Cross-Ext Msg    │       │
  │  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
  └─────────────────────────────────────────────────────────────────────────┘
           ▲                        ▲                        ▲
           │                        │                        │
  ┌────────┴────────┐      ┌────────┴────────┐      ┌────────┴────────┐
  │    SPECTRA      │      │     CORTEX      │      │      HALO       │
  │  (Popup)        │      │  (Side Panel)   │      │  (Side Panel)   │
  ├─────────────────┤      ├─────────────────┤      ├─────────────────┤
  │ audio-engine    │◄────►│ ai-engine       │      │ zen-engine      │
  │ ├─ WebAudio     │ 共享 │ ├─ Gemini API   │      │ ├─ Canvas       │
  │ ├─ WASM Bridge  │ FFT  │ ├─ ACRCloud     │      │ ├─ Alarms       │
  │ └─ PolicyEngine │采样  │ └─ Tesseract    │      │ └─ Fuzzy Search │
  └────────┬────────┘      └─────────────────┘      └─────────────────┘
           │
           ▼
  ┌─────────────────┐
  │   rust-core     │
  │  (WASM Module)  │
  │ ├─ Vocal Sep    │
  │ ├─ Spatial FX   │
  │ └─ Compressor   │
  └─────────────────┘
  ```

  **关键共享点**：

  - **音频采样共享**：CORTEX 的"听歌识曲"可复用 SPECTRA 的 `AudioContext` 采样能力（跨插件通信）。
  - **NEXUS Bus**：三插件通过 `chrome.runtime.sendMessage` + `externally_connectable` 实现互联。
  - **UI Kit 共享**：所有插件共用 `/packages/ui-kit` 的 React 组件（按钮、滑块、卡片）。

---

  ## 1. 现状分析与对比 (Gap Analysis)

  | 功能模块     | 现有实现 (`VolumeBooster`)              | 目标架构 (`SPECTRA`)   | 差距 (Gap)                                |
  | :----------- | :-------------------------------------- | :--------------------- | :---------------------------------------- |
  | **音频引擎** | `AudioContext` + Simple Gain            | **WASM DSP Engine**    | 现有 JS 性能无法支撑实时人声分离。        |
  | **状态管理** | `config.js` 全局变量 + `chrome.storage` | **Repository Pattern** | 现有状态分散，Popup/Bg 没做到其实时同步。 |
  | **通信机制** | 无 (Content 直接读配置)                 | **Typed NEXUS Bus**    | 现有架构无法支持跨插件通信。              |
  | **DOM 操作** | 硬编码在 `content.js`                   | **DOM Adapters**       | 网页改版会导致现有插件全线崩溃。          |
  | **构建系统** | 原生 JS，无构建                         | **Turborepo + Vite**   | 无法支持 TypeScript 和 React 组件复用。   |

  ## 2. 具体代码架构 (Concrete Code Architecture)

  采用 **Monorepo (Turborepo)** 结构，严格分层。

  ```mermaid
  graph TD
      subgraph "NEXUS Apps Layer (User Interface)"
          SpectraApp[Extension A: SPECTRA]
          CortexApp[Extension B: CORTEX]
          HaloApp[Extension C: HALO]
      end
  
      subgraph "Feature Layer (Business Logic)"
          AudioSvc[Audio Service]
          RemoteSvc[Remote Control]
          AISvc[AI Service]
          FocusSvc[Zen Focus Service]
      end
  
      subgraph "Core Layer (Shared Kernel)"
          RPC[Typed NEXUS Bus]
          Repo[Storage Repository]
          WasmBridge[WASM Bridge]
      end
  
      subgraph "Infrastructure (Native)"
          RustCore[Rust DSP Library] -->|Compile| WasmModule[.wasm]
      end
  
      SpectraApp --> AudioSvc
      SpectraApp --> RemoteSvc
      CortexApp --> AISvc
      HaloApp --> FocusSvc
      AudioSvc --> RPC
      AudioSvc --> WasmBridge
      WasmBridge --> WasmModule
  ```

  ### 目录结构 (Directory Structure)

  ```text
  /nexus-os
  ├── /apps                  # 顶层应用
  │   ├── /extension-spectra # Extension A: SPECTRA (Manifest V3)
  │   ├── /extension-cortex  # Extension B: CORTEX
  │   └── /extension-halo    # Extension C: HALO
  ├── /packages              # 共享模块
  │   ├── /nexus-kernel      # 核心通讯 (RPC, Storage)
  │   ├── /ui-kit            # React 组件库 (Tailwind)
  │   └── /features          # 业务逻辑服务
  │       ├── /audio-engine  # 音频处理 (Spectra)
  │       ├── /ai-engine     # AI/OCR (Cortex)
  │       └── /zen-engine    # 专注逻辑 (Halo)
  ├── /rust-core             # [新增] 高性能计算层
  │   ├── /src               # Rust 源码
  │   └── /pkg               # 编译后的 WASM
  └── turbo.json             # 构建配置
  ```

  ## 3. 现有代码迁移策略 (Migration Strategy)

  针对 `c:\Users\QzCrane\Desktop\VolumeBooster\extension` 中的核心文件，执行以下拆解与重构：

  ### A. `content.js` -> `AudioService` & `PolicyEngine`

  *   **Audio Graph 重构**:
      *   原 `scanNodes()` 和 `attachNode()` 中创建 `GainNode`, `BiquadFilterNode` 的逻辑，移动到 `/packages/features/audio-engine/src/WebAudioController.ts`。
      *   利用 TypeScript 封装 `AudioContext` 的管理，解决 `.resume()` 和 `.close()` 的生命周期问题。
  *   **策略引擎抽离**:
      *   原 `calculateDesiredMode()` 和 `isRestrictedSite()` 逻辑极其复杂，移动到 `/packages/features/audio-engine/src/PolicyEngine.ts`。
      *   将 `SITE_RULES` (config.js) 转换为 Policy Rule 类，方便单元测试。

  ### B. `popup.js` -> `MediaApp (React)`

  *   **UI 组件化**:
      *   `slider`, `fill`, `val` -> `<VolumeSlider />` (ui-kit)
      *   `eqDrawer`, `eqInputs`, `drawEqCurve` -> `<EqualizerPanel />` (feature-component)
      *   `drawViz` -> `<VisualizerCanvas />` (使用 Canvas API 但封装在 React Ref 中)
  *   **逻辑解耦**:
      *   原 `update()` 和 `handleVol()` 中的直接 DOM 操作全部移除，改用 `useAudioStore()` (Zustand) 更新状态。
      *   状态变化会自动触发 React 重渲染，无需手动 `ui.fill.style.width = ...`。

  ### C. `background.js` -> `Core Kernel`

  *   **Capture 互斥锁**:
      *   原 `captureLocks` 和 `handleCaptureToggle` 移动到 `/packages/core-kernel/src/services/CaptureManager.ts`。
      *   **Offscreen 管理**: 统一封装 `OffscreenProxy` 类，负责与 offscreen document 通信，避免散落在各处的 `chrome.runtime.sendMessage({target: 'offscreen'})`。

  ## 4. 产品形态澄清: Side Panel vs Plugin Bar

  为什么 Copilot 和 Zen 必须选择 **Side Panel** 而不是 **Popup** (插件栏弹窗)？

  | 特性         | Side Panel (侧边栏)                                | Popup (插件栏弹窗)                                     | 适用场景                                 |
  | :----------- | :------------------------------------------------- | :----------------------------------------------------- | :--------------------------------------- |
  | **持久性**   | **高**。即便切换标签页，侧边栏也可以保持打开状态。 | **极低**。点击页面任何其他地方就会立刻关闭。           | **CORTEX** 需要持续显示笔记/聊天记录。   |
  | **空间**     | **大**。垂直空间利用率高，适合列表和聊天流。       | **小**。通常受限于 ~600x800px，内容多了会拥挤。        | **HALO** 需要展示日历、番茄钟等复杂 UI。 |
  | **多任务**   | **支持**。用户可以一边看视频，一边在侧边栏记笔记。 | **不支持**。弹窗出现时遮挡页面，且无法与页面同时操作。 | 边看视频边查单词 (**CORTEX**)。          |
  | **DOM 隔离** | **完全隔离**。这是独立的 Webview。                 | **完全隔离**。也是独立的 Webview。                     | 两者都安全，不污染页面。                 |

  **结论**:

  *   **SPECTRA** 使用 **Popup** (快进快出，调节音量就走)。
  *   **CORTEX / HALO** 使用 **Side Panel** (伴随式体验，作为浏览器的第二屏幕)。

  ## 5. 高性能技术栈 (High-Performance Tech Stack)

  为了实现 P1 级护城河功能，我们必须引入 Web 前端领域的尖端技术。

  ### A. 计算层: Rust + WebAssembly

  *   **用途**: **人声分离 (Vocal Remover)**、**动态压缩 (Compressor)**、**空间音频 (Spatial Audio)**。
  *   **选型**:
      *   **Language**: **Rust** (内存安全，零开销抽象，拥有最佳的 WASM 工具链 `wasm-pack`)。
      *   **Runtime**: `onnxruntime-web` (用于跑 AI 模型) 或 `rubato` (用于高质量重采样)。
      *   **Integration**: 将 Rust 编译为 `.wasm`，通过 `AudioWorklet` 在独立的音频线程中运行，**绝不阻塞 UI 线程**。

  ### B. 通信层: WebSocket + Protobuf

  *   **用途**: **手机遥控器 (Mobile Remote)**。
  *   **选型**:
      *   **Protocol**: **WebSocket** (全双工实时通信)。
      *   **Serialization**: **Protobuf** (比 JSON 体积更小，解析更快，适合极低延迟操作)。
      *   **Relay Server**: 使用 Cloudflare Workers (无服务器架构) 转发信令，成本极低。

  ### C. 渲染层: React + Framer Motion

  *   **用途**: **Side Panel UI**、**动态频谱 (Visualizer)**。
  *   **选型**:
      *   **Framework**: **React 18** (并发模式)。
      *   **State**: **Zustand** (比 Redux 轻量，且同样支持不可变数据流，适合高频音频数据更新)。
      *   **Animation**: **Framer Motion** (为 Side Panel 提供丝滑的 60fps 进入退出动画)。

  ## 6. 分步实施计划 (Phased Roadmap)

  ### Phase 1: The Core (SPECTRA Basic)

  *   **目标**: 1:1 还原现有功能，但架构升级。
  *   **子任务**:
      *   [x] **1.1** 初始化 Monorepo (pnpm workspace + turbo + tsconfig)
      *   [x] **1.2** 创建 `nexus-kernel` 包 (Typed RPC Bus + Storage Repository)
      *   [x] **1.3** 创建 `audio-engine` 包 (PolicyEngine + WebAudioController)
      *   [x] **1.4** 创建 `extension-spectra` 应用 (Vite 构建 + MV3)

  ### Phase 2: The Moat (SPECTRA Pro)

  *   **目标**: 引入高性能模块。
  *   **任务**:
      *   初始化 `/rust-core`。
      *   编译第一个 WASM 模块 (简单的 Volume Gain 验证链路)。
      *   集成 `AudioWorklet`。

  ### Phase 3: The Ecosystem (CORTEX & HALO)

  *   **目标**: 扩展 B 和 C。
  *   **任务**:
      *   构建 **CORTEX** Side Panel。
      *   构建 **HALO** Side Panel。
      *   接入 Gemini API。







┌─────────────────────────────────────────────────────────────┐
│  /VolumeBooster/.agent/rules/nexus.md  (项目规则，自动加载)   │
│  ~150 tokens                                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  /nexus-os/README.AI.md  (AI 唯一入口)                       │
│  ~150 tokens                                                 │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  packages/contracts/src/*.contracts.ts  (公共 API)          │
│  ~300 tokens (按需)                                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  模块 .ai-context.md  (按需)                                 │
│  各 ~50 tokens                                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  docs/ai-rules/*  (详细规则，按需)                            │
│  各 ~50 tokens                                               │
└─────────────────────────────────────────────────────────────┘



📋 架构风险分析报告 - 最终版
一、当前架构防护体系
┌─────────────────────────────────────────────────────────────┐
│                    防护层级                                   │
├─────────────────────────────────────────────────────────────┤
│ L1 | 项目规则 .agent/rules/nexus.md    | AI 行为约束        │
│ L2 | README.AI.md                      | 阅读引导           │
│ L3 | package.json exports              | 编译时阻止深层导入  │
│ L4 | verify-architecture.js v2         | 构建前检查          │
│    |   ├─ .ai-context.md 存在检查      |                    │
│    |   ├─ contracts 纯净性检查         |                    │
│    |   ├─ 重复定义检查                 |                    │
│    |   ├─ 依赖方向检查                 |                    │
│    |   └─ README 消息表同步检查        |                    │
│ L5 | TypeScript 类型系统               | 类型安全           │
│ L6 | prebuild 自动验证                 | CI 阻断            │
└─────────────────────────────────────────────────────────────┘
二、已检测/可预防的风险

# 风险 检测机制 阻断方式

1 新模块无 .ai-context.md verify 脚本自动扫描 prebuild 失败
2 contracts 添加依赖 verify 检查 dependencies prebuild 失败
3 错误的依赖方向 verify 检查 package.json prebuild 失败
4 深层路径导入 package.json exports 编译失败
5 类型定义重复 verify 检查 (警告) ⚠️ 警告不阻断
6 README 消息表过期 verify 检查 (警告) ⚠️ 警告不阻断
三、无法自动检测的风险

# 风险 原因 缓解措施

1 AI 跳过阅读规则 AI 行为不可强制 项目规则提醒
2 逻辑不一致（仅类型不一致） 类型系统无法检测逻辑 Code Review
3 安全红线违反 需要人工审查 安全规则文档
4 性能问题 静态检查无法检测 测试
