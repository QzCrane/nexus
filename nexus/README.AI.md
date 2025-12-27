# NEXUS AI Portal

**DNA**: Contracts ← Kernel ← Audio-Engine ← Spectra

---

## 指引

### 任务准备

1. plan.md (根目录): 功能矩阵+实施路线
2. 模块职责 (下方): 定位目标模块
3. contracts/.ai-context.md: 通信+数据结构

### 场景导读

- 修改音频模式决策 → docs/policy-decision.md
- 调整跨端状态同步 → docs/cors-data-flow.md
- 引入新 Action → contracts/src/messages/definitions.ts
- 修改依赖/构建/规则 → docs/ai-rules.md

---

## 工作流

- /feature-finish: 交付门禁 (测试+文档)
- /add-dependency: 引入依赖 (查重+登记)
- /new-module: 新建模块 (脚手架)
- /release-spectra: 发布 (版本+打包)

---

## 模块映射

- packages/contracts (@nexus/contracts): 唯一定义源
- packages/nexus-kernel (@nexus/kernel): RPC+Storage+日志
- packages/features/audio-engine (@nexus/audio-engine): WebAudio 节点链
- apps/extension-spectra (@nexus/spectra): 扩展入口+UI
- scripts/: 构建/资源处理脚本 (图标生成、架构验证)

---

## 功能全景

- Audio: 800% 音量, 10 段 EQ, 压限器, 低音, 声道平衡, 延迟
- Video: 旋转/镜像, 画中画, 全屏, 截图, 去黑边, 时间跳转
- FX: 亮度/对比度/饱和度, 灰度/反色, 背景暗化
- Playback: 速率 0.25x-16x, AB 循环, 时间标记
- Settings: 域名预设管理, 热键编辑器 (Options 页)
- Remote: 多会话遥控, QR 码连接, 移动端 UI
- Hotkeys: 可配置快捷键, 70+ 动作, 按键录入
- Engine: CORS 探测, Sticky Badge

---

## 通信协议

- 音频: AUDIO_GET/SET, UI_SYNC → 节点参数+UI 反馈
- 劫持: CAPTURE_TOGGLE/STATE_CHANGE → Capture 生命周期
- 视频: VIDEO_ROTATE/SCREENSHOT/AB_SET → 变换+高级播放
- 遥控: REMOTE_CREATE/GET/CLOSE_SESSION → PeerJS WebRTC
- 同步: TAB_REPORT_MEDIA, MEDIA_REPORT → 5s 心跳

---

## 红线

- Contracts: 禁止包含逻辑实现
- Architecture: 改状态同步前必读 cors-data-flow.md
- Stealth: 非调节行为禁止触发 Badge
- Code: 源码 >200 行 / .ai-context.md >30 行
- Storage: 禁止绕过 kernel 直接用 chrome.storage
- TempFields: toggleMute/volumeDelta 仅作临时指令，禁止持久化

---

## 上下文索引

### 规则

- docs/ai-rules.md: 架构+质量+压缩+安全+依赖

### 架构

- apps/extension-spectra/docs/policy-decision.md: 模式决策矩阵
- apps/extension-spectra/docs/cors-data-flow.md: CORS 探测流程

### 模块 (.ai-context.md)

- packages/contracts/: 纯类型层
- packages/nexus-kernel/: RPC+Storage+日志
- packages/features/audio-engine/: WebAudio 节点链
- apps/extension-spectra/: 扩展顶层
- └─ src/popup/: Popup UI
- └─ src/content/: Content Script
- └─ src/background/: Service Worker
- └─ src/options/: 快捷键配置 (Slots+网站)
- └─ src/content/policy-executor/: CORS+模式
- └─ src/content/lifecycle/: 定时器+观察器
- └─ src/remote/: 遥控弹窗+QR
- └─ src/offscreen-remote/: WebRTC Offscreen
- └─ src/options/: 快捷键编辑器 Settings 页
