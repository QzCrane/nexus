# NEXUS AI 入口

## 阅读策略

| 任务类型      | 必读                           | 禁读     |
| ------------- | ------------------------------ | -------- |
| 理解架构      | 本文件                         | 实现代码 |
| 修改模块      | 本文件 → 目标 `.ai-context.md` | 其他模块 |
| 修复 Bug      | 堆栈涉及的文件                 | 全局扫描 |
| 修改状态/同步 | `docs/cors-data-flow.md`       | -        |

## 项目结构

```text
nexus/
├── packages/contracts/     # 纯类型层 (首读)
├── packages/nexus-kernel/  # RPC + Storage
├── packages/features/audio-engine/  # WebAudio
└── apps/extension-spectra/ # Chrome 扩展
```

## 依赖

`@nexus/contracts ← @nexus/kernel ← @nexus/audio-engine ← extension-spectra`

## 消息速查

| Action            | 请求                           | 响应                       |
| ----------------- | ------------------------------ | -------------------------- |
| AUDIO_GET_STATUS  | void                           | `{config, hasAudio, mode}` |
| AUDIO_SET_CONFIG  | `{config}`                     | `{success}`                |
| CAPTURE_TOGGLE    | `{enabled}`                    | `{status}`                 |
| CAPTURE_GET_STATE | `{tabId?}`                     | boolean                    |
| BADGE_UPDATE      | `{volume, muted, isCapture}`   | void                       |
| UI_SYNC           | `{config, mode, isRestricted}` | void                       |

完整列表：`packages/contracts/src/messages.contracts.ts`

## 策略 v3.2

| 高级需求 | 受限 | 模式            | 色  |
| :------: | :--: | --------------- | :-: |
|    ❌    | 任意 | NATIVE_LITE     | 🔵  |
|    ✅    |  ❌  | NATIVE_WEBAUDIO | 🔵  |
|    ✅    |  ✅  | CAPTURE         | 🟣  |

**高级需求** = volume>100 || visualizer || EQ || compressor || bass
**受限判断** = `internalState.corsStatus !== 'SAFE'` (PENDING 保守视为受限)

## 禁止

- URL 路径规则表 (仅用 CORS 检测)
- 重复定义常量 (从 audio-engine 导入)
- 硬编码 Action (用 `Actions` 常量)
- 绕过数据流架构 (见 cors-data-flow.md)

## 关键约束

- AudioContext: 每 tab 一个，需 resume()
- MV3: 无持久状态，用 chrome.storage
- CORS: 跨域用 Tab Capture

## 文档同步

| 修改类型  | 必须同步                  |
| --------- | ------------------------- |
| 公共 API  | `.ai-context.md`          |
| 消息类型  | 消息速查表 + contracts    |
| 策略逻辑  | `docs/policy-decision.md` |
| 状态/同步 | `docs/cors-data-flow.md`  |

## 工作流

| 触发         | 命令               |
| ------------ | ------------------ |
| 任务交付前   | `/feature-finish`  |
| 新建 Package | `/new-module`      |
| 发版         | `/release-spectra` |

## 文档索引

| 文档     | 路径                             | 触发        |
| -------- | -------------------------------- | ----------- |
| 架构约束 | `docs/ai-rules/architectural.md` | 改架构      |
| 策略表   | `docs/policy-decision.md`        | 改策略      |
| 数据流   | `docs/cors-data-flow.md`         | 改状态/同步 |
