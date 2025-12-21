# NEXUS AI 入口

## 📖 阅读策略

### 按任务类型

| 任务类型       | 必读                                               | 可选读                | 禁止读       |
| -------------- | -------------------------------------------------- | --------------------- | ------------ |
| **理解架构**   | 本文件                                             | contracts             | 实现代码     |
| **修改某模块** | 本文件 → 目标 `.ai-context.md` → 相关 contract     | 实现代码 (仅目标函数) | 其他模块代码 |
| **新增功能**   | 本文件 → `code-quality.md` → 目标 `.ai-context.md` | 类似功能代码          | 不相关模块   |
| **修复 Bug**   | 堆栈中涉及的文件                                   | 相关 contract         | 全局扫描     |
| **创建新文件** | 本文件 → 同目录现有文件                            | `code-quality.md`     | 过度读取     |

### 文档阅读索引

| 文档路径                         | 阅读触发条件       | 不读的情况        |
| -------------------------------- | ------------------ | ----------------- |
| `docs/ai-rules/architectural.md` | 修改架构/新增模块  | 普通功能修改      |
| `docs/ai-rules/code-quality.md`  | 创建/修改代码文件  | 只读代码/Bug 修复 |
| `docs/ai-rules/security.md`      | 涉及 API/密钥/权限 | 不涉及安全        |
| `docs/dependencies/`             | 引入新依赖时       | 不加依赖          |
| `docs/migration/*.md`            | 涉及该迁移主题时   | 无关任务          |

### 工作流使用索引

| Workflow           | 触发条件           | 自动读取        |
| ------------------ | ------------------ | --------------- |
| `/feature-finish`  | 任务完成交付前     | ✅ 用户触发时读 |
| `/new-module`      | 创建新 Package/App | ✅ 用户触发时读 |
| `/add-dependency`  | 引入 npm 依赖      | ✅ 用户触发时读 |
| `/release-spectra` | 打包发布扩展       | ✅ 用户触发时读 |

**原则**：Workflow 只在用户显式触发 (`/xxx`) 时阅读，平时不主动读取。

## 项目结构

```
nexus/
├── README.AI.md              # ⭐ AI 唯一入口 (本文件)
├── scripts/                  # 工程脚本 (verify-architecture 等)
│
├── packages/
│   ├── contracts/            # ⭐ 纯类型层 (AI 首读)
│   ├── nexus-kernel/         # RPC + Storage + Kernel
│   └── features/
│       └── audio-engine/     # WebAudio 核心逻辑
│
├── apps/
│   └── extension-spectra/    # SPECTRA Chrome 扩展
│       ├── .ai-context.md    # 模块上下文
│       ├── test/             # ✅ E2E 测试
│       └── src/              # 源码 (Popup/Content/Background)
│
└── docs/
    ├── ai-rules/             # 架构与安全规则
    └── dependencies/         # 依赖库清单
```

## 依赖关系

```
@nexus/contracts (零依赖)
       ↑
@nexus/kernel ← @nexus/audio-engine
       ↑
extension-spectra
```

## 导入规则

```typescript
import type { AudioConfig } from "@nexus/contracts"; // 类型
import { createMessenger } from "@nexus/kernel"; // 运行时
```

## 消息速查

| Action                 | 请求                           | 响应                         |
| ---------------------- | ------------------------------ | ---------------------------- |
| `AUDIO_GET_STATUS`     | void                           | `{ config, hasAudio, mode }` |
| `AUDIO_SET_CONFIG`     | `{ config }`                   | `{ success }`                |
| `AUDIO_GET_VISUALIZER` | void                           | `{ buffer }`                 |
| `CAPTURE_TOGGLE`       | `{ enabled }`                  | `{ status }`                 |
| `CAPTURE_GET_STATE`    | `{ tabId? }`                   | `boolean`                    |
| `BADGE_UPDATE`         | `{ volume, muted, isCapture }` | void                         |
| `SETTINGS_GET`         | void                           | `GlobalSettings`             |
| `SETTINGS_UPDATE`      | `{ settings }`                 | `{ success }`                |

完整列表见 `packages/contracts/src/messages.contracts.ts`

## 关键约束

- AudioContext：每个标签页一个，需 resume()
- MV3 Service Worker：无持久状态，用 chrome.storage
- CORS：跨域需用 Tab Capture
- E2E 测试：修改 Extension 逻辑后必须遵循 `/feature-finish`

## 🔴 文档同步规则 (强制)

**任何代码修改后，必须同步更新以下文档**：

| 修改类型          | 必须同步的文档                                   |
| ----------------- | ------------------------------------------------ |
| 新增/删除公共 API | 目标模块 `.ai-context.md`                        |
| 新增消息类型      | 本文件"消息速查"表 + `messages.contracts.ts`     |
| 新增依赖          | `docs/dependencies/`                             |
| 修改模块入口      | 目标模块 `.ai-context.md`                        |
| 修改策略逻辑      | `apps/extension-spectra/docs/policy-decision.md` |

**验证命令**：`node scripts/verify-architecture.js`

## 🔴 创建内容前必读 (防止乱拉屎)

**在创建任何新文件/内容前，必须：**

```
1. 先 view_file 同目录现有文件 → 学习格式/风格
2. 评估是否应该合并到现有文件 → 而非新建
3. 新内容必须与现有风格一致 → 行数/结构/语气
```

| 创建类型             | 必须先看                               | 风格标准     |
| -------------------- | -------------------------------------- | ------------ |
| 代码文件             | 同目录 `.ts`                           | < 200 行     |
| `.ai-context.md`     | `packages/nexus-kernel/.ai-context.md` | < 30 行      |
| `docs/ai-rules/*.md` | `architectural.md`, `security.md`      | < 50 行      |
| 工作流 `.md`         | `.agent/workflows/new-module.md`       | 步骤清单格式 |

## 标准作业程序 (SOP)

所有复杂操作已固化为 Workflow，请使用对应指令：

| 场景          | 指令               | 说明                                  |
| ------------- | ------------------ | ------------------------------------- |
| **任务交付**  | `/feature-finish`  | ✅ 提交前的最后一道门禁（必须跑测试） |
| **测试/发版** | `/release-spectra` | 🚀 自动打包 Spectra 扩展              |
| **新模块**    | `/new-module`      | 🏗️ 创建新 Package/App                 |
| **依赖管理**  | `/add-dependency`  | 📦 引入 npm 包                        |

## 详细文档

| 文档           | 路径                                     | 何时阅读             |
| -------------- | ---------------------------------------- | -------------------- |
| 架构约束       | `docs/ai-rules/architectural.md`         | 修改架构/新增模块    |
| 代码质量       | `docs/ai-rules/code-quality.md`          | ⭐ 创建/修改代码文件 |
| 安全红线       | `docs/ai-rules/security.md`              | 处理 API/密钥/权限   |
| 依赖库         | `docs/dependencies/README.md`            | 引入依赖时           |
| 🚧 策略重构 V2 | `docs/migration/strategy-refactor-v2.md` | 修改策略逻辑         |
