# 策略决策

**核心**: 默认配置保持透明旁路；仅恢复非默认站点配置或收到明确用户修改后激活音频处理。

## 决策矩阵

交互 : 需求 : 受限 : 模式 : 色
❌ : 任意 : 任意 : BYPASS : 无
✅ : ❌ : 任意 : BYPASS : 无
✅ : ✅ : ❌ : WEBAUDIO : 🔵
✅ : ✅ : ✅ : CAPTURE : 🟣

## 触发定义

- 需求: volume/mute | EQ | compressor | bass | mono | pan | delay | speed
- 交互: 用户明确修改音频配置或恢复到非默认站点配置
- CORS/受限探测只影响已存在处理需求时选择 WEBAUDIO 或 CAPTURE，本身不得激活处理

## 模式说明

- BYPASS: 与网站原始音频等价，不创建 AudioContext，不锁定音量或播放速度
- WEBAUDIO: 页面内 WebAudio 链路 (Hybrid Sync: 0-100% DOM Attenuation, >100% Boost)
- CAPTURE: Tab Capture 劫持 (高 CPU)

## 全屏策略

Fullscreen 不改变音频运行时：不暂停或关闭 AudioContext，不强制 `volume=1`，不取消静音。DOM 重组只更新媒体 registry；已绑定的 `MediaElementSourceNode` 在整个页面生命周期内保持唯一。

## 音量同步规则

**双向同步**: 全网站 0-100% 范围，插件音量 ↔ 网站原生滑块必须双向同步，（某些网站不读 DOM volume 无效）
**>100% 直取**: 插件 >100% 时，用户拖动网站滑条到 X%，插件直接变为 X%
**幂等更新**: `setDomVolume` 仅在值变化时执行，避免周期性 applyState 覆盖用户操作
**Popup 同步**: 打开 UI 时读取当前 DOM 音量并同步到插件状态 (未交互时)
**角标规则**: 只打开 UI 不算"使用"，不显示角标；调整参数后显示

## 资源回收 (Offscreen)

**策略**: 唯一 offscreen host，由 background coordinator 独占生命周期所有权

- **租约**: 音频使用 `audio:<tabId>`，遥控使用 `remote:<sessionId>`
- **并发**: 创建操作经过单实例互斥锁，任何模块不得直接创建或关闭文档
- **触发**: 所有音频与遥控租约均释放
- **动作**: coordinator 启动 30 秒倒计时，届时再次确认无租约后关闭唯一 host
- **恢复**: Service Worker 启动后通过 host handshake 恢复 processor、遥控会话和租约镜像
- **目的**: 彻底释放 ~50MB 常驻内存，实现零负载待机
