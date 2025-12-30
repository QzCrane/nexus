# Spectra Protocols

| 类   | 消息 action                | 载荷 payload               | 用途                   |
| ---- | -------------------------- | -------------------------- | ---------------------- |
| 音频 | AUDIO_GET/SET, UI_SYNC     | `{gain, pan, mono, ...}`   | 节点参数同步 + UI 反馈 |
| 劫持 | CAPTURE_TOGGLE/STATE       | `{enabled, tabId}`         | 劫持模式生命周期管理   |
| 视频 | VIDEO_ROTATE/SCREENSHOT/AB | `{deg, loop: {start,end}}` | 视频变换 + AB 循环播放 |
| 遥控 | REMOTE_CREATE/GET/CLOSE    | `{roomId, peerId}`         | WebRTC 房间信令        |
| 脚本 | USER_SCRIPT_EXECUTE        | `{code, context}`          | 这里的 eval (UserJS)   |
| 同步 | TAB_REPORT/MEDIA_REPORT    | `{gain, url, title}`       | 5s 心跳 (状态上报)     |

## 核心通信

- **Kernel RPC**: 统一通过 `nexus-kernel` 的 `Client.send()` 发送。
- **Capture Hook**: `content` 与 `offscreen` 通过 Runtime Port 直连 (不通过 Kernel)。
