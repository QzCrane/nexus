# NEXUS AI 入口

> 读取顺序：本文件 → contracts → 模块 .ai-context.md → 实现代码

## 项目结构

```
packages/
├── contracts/           # ⭐ 纯类型 (AI 首读)
│   ├── audio.contracts.ts
│   ├── messages.contracts.ts
│   └── settings.contracts.ts
├── nexus-kernel/        # RPC + Storage
└── features/audio-engine/  # WebAudio

apps/extension-spectra/  # SPECTRA 扩展
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
import type { AudioConfig } from '@nexus/contracts';  // 类型
import { createMessenger } from '@nexus/kernel';      // 运行时
```

## 消息速查

| Action | 请求 | 响应 |
|--------|-----|------|
| `AUDIO_GET_STATUS` | void | `{ config, hasAudio, mode }` |
| `AUDIO_SET_CONFIG` | `{ config }` | `{ success }` |
| `AUDIO_GET_VISUALIZER` | void | `{ buffer }` |
| `CAPTURE_TOGGLE` | `{ enabled }` | `{ status }` |
| `CAPTURE_GET_STATE` | `{ tabId? }` | `boolean` |
| `BADGE_UPDATE` | `{ volume, muted, isCapture }` | void |
| `SETTINGS_GET` | void | `GlobalSettings` |
| `SETTINGS_UPDATE` | `{ settings }` | `{ success }` |

完整列表见 `packages/contracts/src/messages.contracts.ts`
## 关键约束

- AudioContext：每个标签页一个，需 resume()
- MV3 Service Worker：无持久状态，用 chrome.storage
- CORS：跨域需用 Tab Capture

## 详细文档

| 文档 | 路径 |
|-----|------|
| 架构约束 | `docs/ai-rules/architectural.md` |
| 安全红线 | `docs/ai-rules/security.md` |
| 依赖库 | `docs/dependencies/README.md` |
