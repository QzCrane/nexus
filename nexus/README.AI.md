# NEXUS AI Master Portal

**DNA**: `@contracts` (契约) ← `@kernel` (底座) ← `@engine` (逻辑) ← `@apps` (入口)

---

## 📖 核心指引 (Guidance)

在开始任何任务前，强制遵循以下阅读及执行路径：

### 1. 任务准备 (Preparation)

- **了解全景**: [plan.md (根目录)](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/plan.md:0:0-0:0) - 核心功能矩阵与实施路线。
- **定位模块**: 查看下方的 `📦 模块职责表格`。
- **阅读契约**: [contracts/.ai-context.md](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/nexus/packages/contracts/.ai-context.md:0:0-0:0) - 所有的通信与数据结构均在此定义。

### 2. 场景导读 (Scene Guide)

| 任务场景              | 必须深入阅读的文档                                                                                                                             |
| :-------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| **修改音频模式决策**  | [policy-decision.md](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/nexus/apps/extension-spectra/docs/policy-decision.md:0:0-0:0)      |
| **调整跨端状态同步**  | [cors-data-flow.md](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/nexus/apps/extension-spectra/docs/cors-data-flow.md:0:0-0:0)        |
| **引入新功能/Action** | [messages/definitions.ts](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/nexus/packages/contracts/src/messages/definitions.ts:0:0-0:0) |
| **修改依赖/构建**     | [docs/dependencies/](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/nexus/docs/dependencies/README.md:0:0-0:0)                         |
| **重构/拆分文件**     | [code-quality.md](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/nexus/docs/ai-rules/code-quality.md:0:0-0:0)                          |

---

## 🛠 标准工作流 (Workflows)

项目根目录 `.agent/workflows/` 定义了原子级自动化操作：

- **`/feature-finish`**: [交付门禁](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/.agent/workflows/feature-finish.md:0:0-0:0) - 自动化测试、构建与文档熵核验。
- **`/add-dependency`**: [引入依赖](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/.agent/workflows/add-dependency.md:0:0-0:0) - 查重、安装并登记至 `docs/dependencies/`。
- **`/new-module`**: [新建模块](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/.agent/workflows/new-module.md:0:0-0:0) - 自动配置 TS 基类与 `.ai-context.md`。
- **`/release-spectra`**: [正式发布](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/.agent/workflows/release-spectra.md:0:0-0:0) - 版本对齐与 Zip 打包。

---

## 📦 模块职责映射

| 路径                             | 包/目录               | 核心职责                                                                                                                                             |
| :------------------------------- | :-------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts`             | `@nexus/contracts`    | 唯一定义源 (Messages, Config, State)。                                                                                                               |
| `packages/nexus-kernel`          | `@nexus/kernel`       | RPC 总线、Storage 封装、统一日志标记。                                                                                                               |
| `packages/features/audio-engine` | `@nexus/audio-engine` | WebAudio 节点链、模式预判算法。                                                                                                                      |
| `apps/extension-spectra`         | `@nexus/spectra`      | 扩展入口、UI [Popup Context](cci:7://file:///c:/Users/QzCrane/Desktop/VolumeBooster/nexus/apps/extension-spectra/src/popup/.ai-context.md:0:0-0:0)。 |

---

## 🎭 功能全景 (Feature Roadmap)

- **Audio Control**: 800% 音量, 10 段 EQ, 压限器, 低音增强, 左右声道平衡, 延迟补偿。
- **Video Logic**: 旋转/镜像, 画中画, 全屏, 截图下载, 自动去黑边, 时间跳转(± 秒/帧)。
- **FX & AI**: CSS 视觉滤镜, 背景变暗(Dim), AB 循环播放, 时间标记点。
- **Engine**: 自动 CORS 探测 (Analyser 状态机), 单向状态锁存 (Sticky Badge)。

---

## 📡 核心通信协议 (The Bus)

| 分类     | Action 范例                                        | 关键参考                              |
| :------- | :------------------------------------------------- | :------------------------------------ |
| **音频** | `AUDIO_GET/SET`, `UI_SYNC`                         | 控制节点参数与 UI 反馈。              |
| **劫持** | `CAPTURE_TOGGLE`, `CAPTURE_STATE_CHANGE`           | 处理受限站点的 Tab Capture 生命周期。 |
| **视频** | `VIDEO_ROTATE`, `VIDEO_SCREENSHOT`, `VIDEO_AB_SET` | 视频流变换与高级播放逻辑。            |
| **同步** | `TAB_REPORT_MEDIA`, `MEDIA_REPORT`                 | 5s 周期的多端活跃状态心跳。           |

---

## 🚫 开发者红线 (Critical)

- ❌ **Contracts**: 严禁包含逻辑实现。
- ❌ **Architecture**: 修改状态同步前必读 `cors-data-flow.md`。
- ❌ **Stealth**: 严禁在主动调节行为外触发现有 Tab 的 Badge。
- ❌ **Code Style**: 源码 ≤ 200 行；`.ai-context.md` ≤ 30 行。
- ❌ **Storage**: 严禁绕过 `kernel` 直接操作原生 `chrome.storage`。
