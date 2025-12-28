# NEXUS AI Portal

**DNA**: Contracts ← Kernel ← Audio-Engine ← Spectra

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

## 开源

nexus(私有) → `pnpm sync-public` → nexus-public/ → github.com/QzCrane/spectra

排除: scripts/ docs/ .agent/ store-listings/ test/ \*.ai-context.md plan.md

---

## 英文迁移

**已完成** ✅ | 新代码强制英文 | commit 英文 | `pnpm verify`检测

---

## 工作流

/feature-finish(交付) | /add-dependency(依赖) | /new-module(脚手架) | /release-spectra(发布)

---

## 模块

| 包                  | 职责        |
| ------------------- | ----------- |
| @nexus/contracts    | 类型定义源  |
| @nexus/kernel       | RPC+Storage |
| @nexus/audio-engine | WebAudio 链 |
| @nexus/spectra      | 扩展入口    |

---

## 功能

Audio: 800%/EQ/压限/声道/延迟 | Video: 速率 16x/旋转/镜像/PiP/截图 | FX: 亮度/对比度/灰度/暗化
Playback: AB 循环/标记 | Remote: 多会话遥控/QR | Hotkeys: 70+动作 | Engine: CORS/Badge

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
模块: packages/{contracts,nexus-kernel,audio-engine}/.ai-context.md + apps/extension-spectra/.ai-context.md

---

## 路线 2026

Q1 抢占(HALO 深色+标签) | Q2 AI(人声分离+识曲) | Q3 付费(PRO) | Q4 生态(移动+云)
