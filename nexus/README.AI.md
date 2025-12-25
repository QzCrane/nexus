# NEXUS AI

`@contracts ← @kernel ← @features ← @apps`

## 📖 阅读索引

- **快速入门**: 本文件
- **模块上下文**: 目标包 `.ai-context.md`
- **数据流/同步**: `docs/cors-data-flow.md`
- **决策策略**: `docs/policy-decision.md`
- **压缩规范**: `docs/ai-rules/documentation.md`

## 📡 核心消息

- `AUDIO_GET/SET`: 音频状态
- `CAPTURE_TOGGLE/GET`: 劫持控制
- `MEDIA_PLAY/SPEED`: 媒体控制
- `VIDEO_ROTATE/FILT`: 画面控制
  _定义见: `messages/definitions.ts`_

## ⚖️ 策略 v3.2 (模式 & 颜色)

1. **LITE** (🔵): 无高级需求 (默认)
2. **WEB** (🔵): 有需求 & 安全站点
3. **CAPTURE** (🟣): 有需求 & 受限站点
   _高级需求: volume>100 | EQ | comp | bass | viz_

## ⚠️ 绝对禁令

- ❌ 硬编码 Action 或 URL 规则
- ❌ 绕过数据流架构 (必读 `cors-data-flow.md`)
- ❌ 持久化内存状态 (MV3 必须用 chrome.storage)

## 🛠 工作流

- 完成任务: `/feature-finish`
- 新建模块: `/new-module`
- 发布版本: `/release-spectra`
