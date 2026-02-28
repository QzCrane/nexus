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
生命周期: INJECT_CONTENT_SCRIPT → `{tabId}` (popup 按需触发 content script 注入)

## 热更新协议

`扩展更新 → onInstalled(update) → performWarmUpdate → injectWithTransition(每个tab)`

1. 检测旧实例 (`__SPECTRA_TEARDOWN__` 存在?)
2. 调用旧实例 teardown → registry.dispose() → sentinel 写入 DOM stub
3. 注入 injector.js (MAIN) → 注入 content.js (ISOLATED)
4. 新实例 consumeStub() 恢复状态 → 无缝继续

Popup Fallback: sendToTab 失败 → INJECT_CONTENT_SCRIPT → 等待800ms → 重试

## 双向同步协议

### 页面 → 插件

`页面音量变化 → volumechange 事件 → VolumeObserver → onNativeVolumeChange → PolicyExecutor.updateConfig()`

- **VolumeObserver**: 监听 `volumechange`/`ratechange` 事件
- **来源检测**: 通过 `settingByPlugin` 标志位跳过插件触发的变更
- **阈值过滤**: 变化超过 0.005 才触发同步，避免抖动

### 插件 → 页面

`Popup/快捷键 → AUDIO_SET_CONFIG → Background → Content → setDomVolume() → 应用到媒体元素`

- **setDomVolume**: 设置 `settingByPlugin = true`，应用音量，异步清理标志
- **YouTube 特殊处理**: 额外调用 `setYouTubeVolume()` 同步原生 UI
- **监控初始化**: `ensureMonitoring()` 确保所有媒体元素被监听

### 防循环机制

```typescript
// 插件设置时标记
s.settingByPlugin = true;
media.volume = newVol;
setTimeout(() => (s.settingByPlugin = false), 100);

// 事件监听中跳过
media.addEventListener("volumechange", () => {
  if (s.settingByPlugin) return; // 防止循环
  onNativeVolumeChange(volume);
});
```

详见 [bidirectional-sync-principles.md](./bidirectional-sync-principles.md)。

## 核心通信

Kernel RPC: 统一通过`nexus-kernel.Client.send()`
Capture Hook: content 与 offscreen 通过 Runtime Port 直连(不经 Kernel)
