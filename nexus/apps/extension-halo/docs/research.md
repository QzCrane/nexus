---
type: explanation
status: draft
audience: developer
---

# HALO 市场调研汇总 (2025)

> 核心定位: Zero Upload | Zero Tracking | Zero Cost | Local First

## 竞品痛点 → HALO 差异化

### Dark Reader (6M+)

痛点: 性能(500ms+/CPU 高/卡顿) | 白闪 | 配置复杂(4 种模式) | 兼容差(Akamai 封禁/PDF 反转)
→ HALO: CSS filter 注入(<50ms) | document_start 早注入 | 一键开关+智能白名单 | 纯 CSS 零 JS 轮询

### OneTab (2M+)

痛点: 数据丢失(崩溃/更新后消失) | 无云同步 | localStorage 溢出静默丢弃 | 功能单一(无搜索/分组)
→ HALO: IndexedDB+chrome.storage.sync 双备份 | Fuse.js 模糊搜索 | 分组/预览

### Toby (1M+)

痛点: $40/年付费墙 | 曾承诺永久免费
→ HALO: 开源永久免费

### Lightshot (10M+)

痛点: 隐私灾难(公开 URL 可遍历/无加密/银行信息泄露) | 默认上传 | 功能简陋(无 OCR/滚动截图)
→ HALO: 100%本地处理 | Canvas 批注 | Tesseract.js 本地 OCR

### QR 扩展 (5M+)

痛点: 隐私(动态 QR 追踪) | Quishing 钓鱼 | 过度权限
→ HALO: 离线生成 | URL 预览(防钓鱼) | 仅 activeTab

### SmoothScroll (500k+)

痛点: YouTube 卡顿 | 老设备性能差 | 配置复杂
→ HALO: CSS scroll-behavior 优先(零 JS) | 自动降级 | 简单滑块

### Clipboard 扩展 (500k+)

痛点: 隐私(闭源访问所有复制) | 明文存储 | 剪贴板劫持
→ HALO: 开源可审计 | 敏感检测 | 只读模式 | 仅 clipboardRead

### StayFocusd/BlockSite (10M+)

痛点: 易绕过(换浏览器/改时间/清数据) | 配置复杂 | 付费墙
→ HALO: 时间服务器校验+挑战任务+锁定模式 | 简单界面

## 需求频率

1.性能拖慢(愤怒) | 2.数据丢失(绝望) | 3.隐私泄露(恐惧) | 4.复杂难用(困惑)

## HALO 护城河

L3 信任: 开源+零遥测 | L2 性能: CSS 注入<50ms | L1 隐私: 100%本地 | L0 功能: 深色+标签+截图一站式

## 趋势机会

✅ 阅读模式(去广告纯净) | ✅ 快捷便签(页面笔记) | ❌ 页面录制/下载管理(复杂非核心)

## 技术选型

截图: chrome.tabs.captureVisibleTab + html2canvas | 批注: Canvas/Fabric.js | OCR: Tesseract.js(WASM)
存储: IndexedDB(大容量) + chrome.storage.sync(同步) | 搜索: Fuse.js | 备份: JSON 导出+可选 GDrive
