# Lightshot 市场调研 (2024-2025)

> **目标**: 识别痛点 → 设计 HALO 截图功能差异化方案  
> **数据源**: 安全报告 | Reddit | 产品评测

---

## 📊 基础数据

| 指标     | 数值             |
| -------- | ---------------- |
| 用户量   | 10M+ (全平台)    |
| 类型     | 扩展 + 桌面应用  |
| 核心问题 | **严重隐私风险** |

---

## 🔴 核心痛点 (按严重程度)

### P0: 隐私安全灾难 ⭐⭐⭐⭐⭐

| 问题             | 描述                           |
| ---------------- | ------------------------------ |
| **公开 URL**     | 上传截图获得可猜测的公开链接   |
| **URL 可遍历**   | 简单修改 URL 即可查看他人截图  |
| **无加密**       | 服务器存储无任何保护           |
| **敏感信息泄露** | 银行详情/通讯录/私密视频被曝光 |
| **机构封禁**     | Missouri S&T 等高校已禁用      |

> ⚠️ 2020 年事件: Lightshot 数据泄露导致钓鱼攻击 + 加密货币账户被盗

### P1: 默认上传服务器 ⭐⭐⭐⭐

- 用户不知情下截图被上传
- 无明确的"仅本地保存"选项
- 即使删除本地，服务器仍保留

### P2: 功能有限 ⭐⭐

- 批注工具简陋
- 无滚动截图
- 无 OCR
- 无延迟截图

---

## 🟢 竞品分析

| 工具              | 类型       | 本地保存    | 隐私      | 功能                    |
| ----------------- | ---------- | ----------- | --------- | ----------------------- |
| **ShareX**        | 桌面 (Win) | ✅ 完全控制 | ✅ 开源   | 最强: 滚动/录屏/OCR/GIF |
| **Greenshot**     | 桌面 (Win) | ✅ 自动保存 | ✅ 开源   | 良好: 批注/插件         |
| **Snipping Tool** | Win 内置   | ✅ 自动     | ✅ 本地   | 基础: 区域/延迟/录屏    |
| **FireShot**      | 扩展       | ✅ 本地     | ✅ 无上传 | 良好: 整页/PDF          |
| **GoFullPage**    | 扩展       | ✅ 本地     | ✅ 无权限 | 简洁: 整页截图          |

---

## 💡 HALO 差异化方向

### 核心卖点

| 痛点     | HALO 方案                                |
| -------- | ---------------------------------------- |
| 隐私泄露 | **100% 本地处理** 无任何上传             |
| 无加密   | **无需加密** (不存服务器)                |
| 功能简陋 | **丰富批注**: 箭头/方框/文字/马赛克/高亮 |
| 无 OCR   | **本地 OCR** (Tesseract.js)              |

### MVP 功能 (W6)

```
v0.2 截图
├─ 区域/窗口/整页截图
├─ 批注工具 (箭头/方框/文字/马赛克)
├─ 本地保存 (PNG/JPEG)
├─ 复制到剪贴板
├─ 快捷键绑定
└─ 隐私声明: "永不上传"
```

### 进阶功能 (Q2)

```
├─ 滚动截图 (整页)
├─ 延迟截图
├─ 本地 OCR (Tesseract.js)
├─ 历史记录 (本地)
└─ 快速分享 (生成本地 HTML 预览)
```

### 技术选型

```
截图: chrome.tabs.captureVisibleTab + html2canvas (整页)
批注: Canvas API / Fabric.js
OCR: Tesseract.js (WASM)
存储: IndexedDB (历史) + 下载 API (保存)
```

---

## 📝 用户原声

> "Lightshot uploads are publicly accessible, anyone can view them by guessing URLs" — Security Report

> "Missouri S&T blocked Lightshot on all managed computers due to cybersecurity vulnerabilities" — mst.edu 2025

> "I found someone's bank details browsing random Lightshot URLs" — Reddit

> "ShareX is overkill, I just want quick local screenshots" — Reddit

---

## 🔗 安全事件时间线

| 时间    | 事件                        |
| ------- | --------------------------- |
| 2020    | 数据泄露导致钓鱼攻击        |
| 2020    | 加密货币账户信息被发现      |
| 2024    | 持续有敏感信息曝光报告      |
| 2025.08 | Missouri S&T 禁用 Lightshot |

**机会**: 用户正在寻找隐私友好的替代品，HALO 的"零上传"承诺可作为核心卖点
