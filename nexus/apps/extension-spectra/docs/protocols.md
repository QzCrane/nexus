# Spectra Protocols

音频: AUDIO_GET/SET, UI_SYNC → `{gain,pan,mono,...}` (节点参数+UI 反馈)
劫持: CAPTURE_TOGGLE/STATE → `{enabled,tabId}` (劫持生命周期)
视频: VIDEO_ROTATE/SCREENSHOT/AB → `{deg,loop:{start,end}}` (变换+AB 循环)
遥控: REMOTE_CREATE/GET/CLOSE → `{roomId,peerId}` (WebRTC 信令)
脚本: USER_SCRIPT_EXECUTE → `{code,context}` (UserJS eval)
同步: TAB_REPORT/MEDIA_REPORT → `{gain,url,title}` (5s 心跳状态上报)

## 核心通信

Kernel RPC: 统一通过`nexus-kernel.Client.send()`
Capture Hook: content 与 offscreen 通过 Runtime Port 直连(不经 Kernel)
