# 策略决策

**核心**: 调节行为/进入劫持才激活增强，否则保持 LITE。

## 决策矩阵

交互 : 需求 : 受限 : 模式 : 色
❌ : 任意 : 任意 : LITE : 🔵
✅ : ❌ : 任意 : LITE : 🔵
✅ : ✅ : ❌ : WEBAUDIO : 🔵
✅ : ✅ : ✅ : CAPTURE : 🟣

## 触发定义

- 需求: volume>100 | EQ | comp | bass | viz
- 交互: 手动调节非 enabled 参数
- 劫持即交互: isPredictedCapture 为真自动触发

## 模式说明

- LITE: DOM 原始控制 (0-100%)
- WEBAUDIO: 页面内 WebAudio 链路 (Hybrid Sync: 0-100% DOM Attenuation, >100% Boost)
- CAPTURE: Tab Capture 劫持 (高 CPU)

## 全屏策略

**双模式暂停**: CAPTURE 和 WEBAUDIO 模式均需在全屏时暂停

- **根因**: Chrome 已知 Bug - `createMediaElementSource()` 创建的 `MediaElementSourceNode` 与全屏渲染管线冲突
- **机制**: Injector 拦截 `requestFullscreen()` → 发送 `SPECTRA_PAUSE_FOR_FULLSCREEN` → 等待 `SPECTRA_PAUSE_CONFIRMED` (200ms 超时)
- **CAPTURE**: 调用 `captureManager.request(false)` 停止抓取
- **WEBAUDIO**: 调用 `audioController.suspendContext()` 暂停 AudioContext (disconnect 无效，因为 MediaElementSourceNode 永久绑定)
- **恢复**: 全屏完成后 500ms 调用 `resumeContext()` + `applyState()` 重新激活

## 音量同步规则

**双向同步**: 全网站 0-100% 范围，插件音量 ↔ 网站原生滑块必须双向同步，（某些网站不读 DOM volume 无效）
**>100% 直取**: 插件 >100% 时，用户拖动网站滑条到 X%，插件直接变为 X%
**幂等更新**: `setDomVolume` 仅在值变化时执行，避免周期性 applyState 覆盖用户操作
**Popup 同步**: 打开 UI 时读取当前 DOM 音量并同步到插件状态 (未交互时)
**角标规则**: 只打开 UI 不算"使用"，不显示角标；调整参数后显示

## 资源回收 (Offscreen)

**策略**: 45 秒空闲销毁

- **触发**: 所有活动抓取会话结束
- **动作**: 启动 45s 倒计时 → `chrome.offscreen.closeDocument()`
- **恢复**: 新抓取请求时自动重建 (`ensureOffscreen`)
- **目的**: 彻底释放 ~50MB 常驻内存，实现零负载待机
