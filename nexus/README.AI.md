# NEXUS AI 入口

## 📖 阅读策略

| 任务类型       | 必读                                           | 禁止读       |
| -------------- | ---------------------------------------------- | ------------ |
| **理解架构**   | 本文件                                         | 实现代码     |
| **修改某模块** | 本文件 → 目标 `.ai-context.md` → 相关 contract | 其他模块代码 |
| **新增功能**   | 本文件 → `code-quality.md` → 目标上下文        | 不相关模块   |
| **修复 Bug**   | 堆栈涉及的文件                                 | 全局扫描     |
| **创建文件**   | 同目录现有文件 (学习风格)                      | 过度读取     |

## 项目结构

```text
nexus/
├── README.AI.md              # ⭐ AI 唯一入口 (本文件)
├── packages/
│   ├── contracts/            # ⭐ 纯类型层 (AI 首读)
│   ├── nexus-kernel/         # RPC + Storage
│   └── features/audio-engine # WebAudio 核心
├── apps/extension-spectra/   # Chrome 扩展
└── docs/ai-rules/            # 架构/安全规则
```

## 依赖关系与导入

```text
@nexus/contracts (零依赖) ← @nexus/kernel ← @nexus/audio-engine ← extension-spectra
```

```typescript
import type { AudioConfig } from "@nexus/contracts"; // 类型
import { createMessenger } from "@nexus/kernel"; // 运行时
```

## 消息速查

### NEXUS 协议 (跨组件通信)

| Action                   | 请求                           | 响应                         |
| ------------------------ | ------------------------------ | ---------------------------- |
| `AUDIO_GET_STATUS`       | void                           | `{ config, hasAudio, mode }` |
| `AUDIO_SET_CONFIG`       | `{ config }`                   | `{ success }`                |
| `AUDIO_GET_VISUALIZER`   | void                           | `{ buffer }`                 |
| `CAPTURE_TOGGLE`         | `{ enabled }`                  | `{ status }`                 |
| `CAPTURE_GET_STATE`      | `{ tabId? }`                   | `boolean`                    |
| `CAPTURE_UPDATE_CONFIG`  | `{ tabId, config }`            | void                         |
| `CAPTURE_STATE_CHANGE`   | `{ enabled }`                  | void (广播)                  |
| `GLOBAL_SETTINGS_UPDATE` | `{ settings }`                 | void (广播)                  |
| `BADGE_UPDATE`           | `{ volume, muted, isCapture }` | void                         |
| `SETTINGS_GET`           | void                           | `GlobalSettings`             |
| `SETTINGS_UPDATE`        | `{ settings }`                 | `{ success }`                |

### Offscreen 专用 (Background ↔ Offscreen)

| Action                    | 参数                          | 说明           |
| ------------------------- | ----------------------------- | -------------- |
| `OFFSCREEN_START`         | `{ tabId, streamId, config }` | 启动 Capture   |
| `OFFSCREEN_STOP`          | `{ tabId }`                   | 停止 Capture   |
| `OFFSCREEN_UPDATE_CONFIG` | `{ tabId, config }`           | 更新音频配置   |
| `OFFSCREEN_GET_VIZ`       | `{ tabId }`                   | 获取可视化数据 |

完整列表：`packages/contracts/src/messages.contracts.ts`

## 🎯 策略 v3.0 (行为检测)

| 高级需求 | 受限站点 | 模式            |
| -------- | -------- | --------------- |
| ❌       | 任意     | NATIVE_LITE     |
| ✅       | ❌       | NATIVE_WEBAUDIO |
| ✅       | ✅       | CAPTURE         |

**高级需求** = 音量>100% || 频谱开启 || EQ 非零 || 压缩器 || 低音增强

**受限站点** = `DefaultRestrictedDomains` + 用户注册表 (动态 CORS 检测)

## ❌ 禁止事项

| 禁止                      | 原因                                       |
| ------------------------- | ------------------------------------------ |
| 添加 URL 路径规则表       | v3.0 仅用行为检测                          |
| 重复定义常量              | 必须从 @nexus/audio-engine 导入            |
| 混用消息格式              | 统一 UPPER_SNAKE_CASE                      |
| 在策略判断中匹配 URL 路径 | 已弃用                                     |
| **硬编码 Action 字符串**  | 必须用 `Actions` / `OffscreenActions` 常量 |

## 关键约束

- AudioContext：每个标签页一个，需 resume()
- MV3 Service Worker：无持久状态，用 chrome.storage
- CORS：跨域需用 Tab Capture

## 🔧 符号索引工具

**删除导出/修改常量前必须检查引用**：

```bash
# 查找符号的所有引用
node scripts/check-exports.js --refs DefaultSiteRules

# 检查未使用的导出
node scripts/check-exports.js --unused

# 架构验证 (包含硬编码检查)
node scripts/verify-architecture.js
```

**Action 常量**：所有消息 action 必须使用 `@nexus/contracts` 的 `Actions` 常量

## 🔴 强制规则

### 文档同步 (每次修改后)

| 修改类型 | 必须同步                                         |
| -------- | ------------------------------------------------ |
| 公共 API | 目标模块 `.ai-context.md`                        |
| 消息类型 | 本文件消息速查表 + `messages.contracts.ts`       |
| 依赖     | `docs/dependencies/`                             |
| 策略逻辑 | `apps/extension-spectra/docs/policy-decision.md` |

**验证**：`node scripts/verify-architecture.js`

### 创建文件前

1. `view_file` 同目录现有文件 → 学习风格
2. 评估合并到现有文件 vs 新建
3. 遵守行数上限：源码 < 200 行，`.ai-context.md` < 30 行

## 📋 Workflow 索引

| 指令               | 触发条件     | 说明            |
| ------------------ | ------------ | --------------- |
| `/feature-finish`  | 任务交付前   | 测试 + 文档同步 |
| `/new-module`      | 新建 Package | 脚手架 + 注册   |
| `/add-dependency`  | 引入 npm 包  | 查重 + 记录     |
| `/release-spectra` | 打包发布扩展 | 测试 + 打包     |

> Workflow 只在用户显式触发 `/xxx` 时阅读

## 📚 文档索引

| 文档     | 路径                               | 触发条件           |
| -------- | ---------------------------------- | ------------------ |
| 架构约束 | `docs/ai-rules/architectural.md`   | 修改架构/新增模块  |
| 代码质量 | `docs/ai-rules/code-quality.md`    | 创建/修改代码文件  |
| 安全红线 | `docs/ai-rules/security.md`        | 涉及 API/密钥/权限 |
| 策略表   | `apps/.../docs/policy-decision.md` | 修改策略逻辑       |
