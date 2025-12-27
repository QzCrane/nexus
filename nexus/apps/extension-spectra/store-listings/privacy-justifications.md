# SPECTRA - Chrome Web Store 隐私权规范填写指南

## 1. 单一用途说明 (Single Purpose)

```
SPECTRA is an audio and video enhancement extension that provides volume amplification, playback speed control, and equalizer adjustments for any media content in the browser.
```

## 2. 各权限理由

### tabs 权限

```
Required to detect when users switch between tabs, allowing the extension to apply the correct audio settings for each tab and update the badge indicator showing current volume/mute status.
```

### scripting 权限

```
Required to inject the audio processing script into web pages. This script intercepts HTML5 audio/video elements to apply volume amplification, equalizer, and playback speed adjustments in real-time.
```

### storage 权限

```
Required to save user preferences including volume levels, equalizer presets, playback speed settings, and per-site configurations. All data is stored locally on the user's device.
```

### tabCapture 权限

```
Required for the audio capture feature that enables volume amplification beyond 100%. This permission allows capturing the tab's audio stream to route it through the Web Audio API for processing.
```

### offscreen 权限

```
Required to maintain audio processing when the popup is closed. The offscreen document handles continuous audio capture and remote control WebRTC connections without interrupting user browsing.
```

### host_permissions (<all_urls>)

```
Required to inject content scripts into all websites so users can control audio/video on any webpage. The extension only processes media elements and does not collect or transmit any browsing data.
```

### 远程代码 (Remote Code) - 如有提示

```
This extension does NOT use any remote code. All JavaScript is bundled locally within the extension package.
```

---

## 3. 数据使用声明

### 勾选项建议：

- ✅ "I certify that this extension does not collect or transmit user data"
- 或者选择符合实际的选项

### 如果有远程控制功能的数据说明：

```
The remote control feature uses peer-to-peer WebRTC connections (via PeerJS) to allow users to control their own browser from their mobile device. Connection IDs are randomly generated and not stored on any server. No personal data is collected or transmitted to third parties.
```

---

## 4. 隐私政策 (如需要)

如果要求填写隐私政策 URL，可以：

1. 留空 (如果没有收集任何数据)
2. 或使用 GitHub 仓库的隐私政策页面

---

复制以上英文内容到 Chrome Developer Dashboard 的隐私权规范页面对应字段即可。
