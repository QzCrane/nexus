# 策略决策

**核心**: 调节行为/进入劫持才激活增强，否则保持 LITE。

## 决策矩阵

| 交互 | 需求 | 受限 | 模式     | 色  |
| :--: | :--: | :--: | :------- | :-: |
|  ❌  | 任意 | 任意 | LITE     | 🔵  |
|  ✅  |  ❌  | 任意 | LITE     | 🔵  |
|  ✅  |  ✅  |  ❌  | WEBAUDIO | 🔵  |
|  ✅  |  ✅  |  ✅  | CAPTURE  | 🟣  |

## 触发定义

- 需求: volume>100 | EQ | comp | bass | viz
- 交互: 手动调节非 enabled 参数
- 劫持即交互: isPredictedCapture 为真自动触发

## 模式说明

- LITE: DOM 原始控制 (0-100%)
- WEBAUDIO: 页面内 WebAudio 链路
- CAPTURE: Tab Capture 劫持 (高 CPU)

## 资源回收 (Offscreen)

**策略**: 45 秒空闲销毁

- **触发**: 所有活动抓取会话结束
- **动作**: 启动 45s 倒计时 → `chrome.offscreen.closeDocument()`
- **恢复**: 新抓取请求时自动重建 (`ensureOffscreen`)
- **目的**: 彻底释放 ~50MB 常驻内存，实现零负载待机
