# NEXUS AI Portal

**DNA**: Contracts ← Kernel ← {Audio-Engine} ← {Spectra, Halo}

---

## 指引

**任务准备**: plan.md(路线) → 模块定位 → contracts/.ai-context.md(通信)

**场景导读**:

- 音频模式 → docs/policy-decision.md
- 状态同步 → docs/cors-data-flow.md
- 新 Action → contracts/src/messages/definitions.ts
- 规则/依赖 → docs/ai-rules.md
- 开源同步 → `pnpm sync-public`

---

## 开源 (双仓库同步)

**每次开发完成后必须同步双仓库**:

1. `git add + commit + push` (nexus)
2. `pnpm sync-public`
3. `cd ../nexus-public && git push -f origin main`

nexus(私有) → nexus-public/ → github.com/QzCrane/spectra

排除: scripts/ docs/ .agent/ store-listings/ test/ assets/ \*.ai-context.md + 空包

---

## 英文迁移

新代码强制英文 | commit 英文 | `pnpm verify`检测

---

## 工作流

/feature-finish(交付) | /add-dependency(依赖) | /new-module(脚手架) | /release-spectra(发布)

---

## 模块

| 包                  | 职责                   |
| ------------------- | ---------------------- |
| @nexus/contracts    | 类型定义源             |
| @nexus/kernel       | RPC+Storage+Log        |
| @nexus/ui-kit       | 共享 UI 组件           |
| @nexus/audio-engine | WebAudio 链            |
| @nexus/spectra      | 媒体扩展 (Popup)       |
| @nexus/halo         | 万能工具箱 (SidePanel) |

---

## 功能

**SPECTRA**: Audio 800%/EQ/压限/声道/延迟 | Video 速率 16x/旋转/镜像/PiP/截图 | AB 循环/标记 | 遥控 QR+WebRTC

**HALO**: 工具箱(二维码/颜色/JSON/尺子/大纲) | 效率(标签/截图/剪贴板) | AI(识曲/摘要/OCR) | 深色(⏸️ 搁置)

---

## 协议

| 类   | 消息                       | 用途      |
| ---- | -------------------------- | --------- |
| 音频 | AUDIO_GET/SET, UI_SYNC     | 节点+反馈 |
| 劫持 | CAPTURE_TOGGLE/STATE       | 生命周期  |
| 视频 | VIDEO_ROTATE/SCREENSHOT/AB | 变换+播放 |
| 遥控 | REMOTE_CREATE/GET/CLOSE    | WebRTC    |
| 同步 | TAB_REPORT/MEDIA_REPORT    | 5s 心跳   |

---

## 红线

Contracts 禁逻辑 | 改同步读 cors-data-flow | 非调节禁 Badge | 源码 ≤200 行 | 禁绕 kernel 存储 | toggleMute/volumeDelta 禁持久化 | 新代码英文注释

---

## 验证 v5

`pnpm verify`: .ai-context | contracts 纯净 | 行数 150/200 | 硬编码 Action | HTML 引用 | 中文注释 | 依赖方向

---

## 索引

规则: docs/ai-rules.md
架构: policy-decision.md, cors-data-flow.md
模块: packages/{contracts,nexus-kernel,ui-kit}/.ai-context.md + packages/features/audio-engine/.ai-context.md + apps/{extension-spectra,extension-halo}/.ai-context.md

---

## 路线 2026

Q1 抢占(HALO 工具箱+标签) | Q2 AI(人声分离+识曲) | Q3 付费(PRO) | Q4 生态(移动+云)
