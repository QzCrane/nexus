# SPECTRA - Chrome Web Store 隐私权规范填写指南

> 本文必须与 `PRIVACY.md` 和实际发布包保持一致。遥控功能存在出站网络流量，因此不要再勾选或声称“完全不传输任何数据”。

## 1. 单一用途说明 (Single Purpose)

```text
SPECTRA enhances audio and video playback with volume amplification, equalizer, playback controls, and an optional authenticated mobile remote.
```

## 2. 各权限理由

### tabs 权限

```text
Required to bind settings and remote-control sessions to the exact user-selected tab, clean up state when a tab closes or navigates, and update that tab's badge. When the user explicitly enables the mobile remote, the selected tab's title and domain are sent only to the authenticated paired device.
```

### webNavigation 权限

```text
Required to distinguish a real top-level document navigation from same-document History API changes, so SPECTRA can tear down audio and remote state only when the page is actually replaced. Navigation events are processed locally and are not uploaded.
```

### storage 权限

```text
Required to save volume, equalizer, playback, appearance, hotkey, and per-site preferences locally. Active remote pairing secrets are not placed in persistent extension storage.
```

### alarms 权限

```text
Required only to preserve the 30-second offscreen idle shutdown grace period across Manifest V3 service-worker suspension. It does not schedule network requests, analytics, or recurring background work.
```

### tabCapture 权限

```text
Required to capture the user-selected tab's audio and route it through the local Web Audio processing graph. SPECTRA does not record or upload captured audio.
```

### offscreen 权限

```text
Required for the single Manifest V3 offscreen document that owns continuous local audio processing and optional authenticated PeerJS WebRTC connections while the popup is closed.
```

### host_permissions (`<all_urls>`)

```text
Required to detect and control media elements on websites where the user invokes SPECTRA. Website content and media are processed locally. The optional remote sends only the selected tab's title, domain, and media-control state to the authenticated paired device; it does not send page content, favicons, audio, or video.
```

### userScripts 权限

```text
Required to execute only user-authored custom hotkey scripts inside Chrome's userScripts sandbox after the user explicitly configures and triggers them.
```

### scripting 权限

```text
Required to install SPECTRA's locally bundled audio and media-control runtime in the active page. It is not used to download or execute remote code.
```

### 远程代码 (Remote Code)

```text
The extension does not execute remotely hosted JavaScript or WebAssembly. PeerJS, QR generation, and all extension logic are bundled in the submitted package. The separately hosted mobile remote also serves a pinned local PeerJS bundle and has a Content Security Policy that disallows third-party scripts.
```

## 3. 数据使用声明

### Dashboard 申报建议

- 不要勾选 “does not collect or transmit user data” 这一与遥控实际行为冲突的声明。
- 保守申报可选遥控会传输的 **Website content / Web history metadata**：仅限用户所选标签页的标题和域名，以及音量、静音、播放和倍速状态。
- 用途选择 **App functionality**；明确不出售、不用于广告、分析、信用评估或个性化推荐。
- 说明该传输只有在用户主动创建遥控会话，并完成 HMAC 认证之后才发生。

### 遥控网络与第三方说明

```text
The optional remote is served by Cloudflare Pages and uses PeerJS signaling at 0.peerjs.com, Google STUN, and PeerJS TURN when direct WebRTC connectivity is unavailable. These providers may process IP addresses and connection metadata. After an HMAC-SHA-256 pairing challenge succeeds, the selected tab's title, domain, and media-control state are sent over WebRTC to the paired device. Commands return over the same authenticated channel. SPECTRA does not transmit page content, favicons, audio, or video, and the developer does not operate a server that receives remote state or commands.
```

## 4. 隐私政策

发布时提供指向仓库中 `PRIVACY.md` 同内容页面的公开 URL。由于可选遥控会处理网站元数据和第三方网络连接，不应留空。
