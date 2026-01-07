# Spectra Protocols

## 核心逻辑 (快捷键与消息)

核心原则: Content Script 是状态的唯一事实来源 (SSOT)。Background 仅负责转发命令。

### 1. 全局快捷键流

`用户 (Alt+Up) → Chrome Command → Background (shortcuts.ts) → Content (message-handler.ts) → 执行动作`

- **Background**: 检测命令，向活动标签页转发 `SHORTCUT_TRIGGER`。无逻辑/不读取配置。
- **Content**:
  1. 接收 `SHORTCUT_TRIGGER`。
  2. `executeHotkeyAction` 决定逻辑 (音量/倍速/画中画)。
  3. `sendVolumeAction` 根据当前配置计算新状态。
  4. 调用 `updateConfig({volume}, {showOSD: true})`。
  5. **结果**: 状态更新 + 显示 OSD 音量条 + UI 通过 `AUDIO_SET_CONFIG` 同步。

### 2. UI 更新流

`Popup (滑块) → AUDIO_SET_CONFIG → Background (Storage) → Content (Listener)`

- **Popup**: 发送带有新值的 `AUDIO_SET_CONFIG`。
- **Background**: 持久化到 `tabSession` (存储)。广播更新。
- **Content**: `PolicyExecutor` 监听存储变化 → 应用到 WebAudio/TAB。

### 3. 注册表与预设

- **Tab Session (会话)**: 临时，自动保存到 `tabSession` 存储。
- **Domain Preset (域名预设)**: 仅通过 `btnSave` (💾) 手动保存。按域名存储在 `siteSettings`。
- **加载优先级**: 背景脚本合并顺序 `默认值 < 域名预设 < 会话配置`。

## 消息协议

音频: AUDIO_GET/SET, UI_SYNC → `{gain,pan,mono,...}` (节点参数+UI 反馈)
劫持: CAPTURE_TOGGLE/STATE → `{enabled,tabId}` (劫持生命周期)
快捷键: SHORTCUT_TRIGGER → `{command}` (只传指令名，不传配置)
设置: SETTINGS_UPDATE/GET → `{settings}` (通用设置同步)
视频: VIDEO_ROTATE/SCREENSHOT/AB → `{deg,loop:{start,end}}` (变换+AB 循环)
遥控: REMOTE_CREATE/GET/CLOSE → `{roomId,peerId}` (WebRTC 信令)
脚本: USER_SCRIPT_EXECUTE → `{code,context}` (UserJS eval)
同步: TAB_REPORT/MEDIA_REPORT → `{gain,url,title}` (5s 心跳状态上报)

## 核心通信

Kernel RPC: 统一通过`nexus-kernel.Client.send()`
Capture Hook: content 与 offscreen 通过 Runtime Port 直连(不经 Kernel)
