# OneTab/Toby 市场调研 (2024-2025)

> **目标**: 识别痛点 → 设计 HALO 标签管理差异化方案  
> **数据源**: Chrome/Firefox 商店 | Reddit | 产品评测

---

## 📊 基础数据

| 扩展   | 用户量 | 评分  | 痛点密度    |
| ------ | ------ | ----- | ----------- |
| OneTab | 2M+    | 4.3/5 | 高          |
| Toby   | 1M+    | 4.6/5 | 中 (付费墙) |

---

## 🔴 OneTab 核心痛点

### P0: 数据丢失 ⭐⭐⭐⭐⭐

| 问题             | 描述                           |
| ---------------- | ------------------------------ |
| **标签全部丢失** | Chrome 崩溃/更新后数千标签消失 |
| **无云备份**     | 仅本地存储，无自动同步         |
| **恢复困难**     | 需手动导出 TXT，用户常忘记     |
| **存储溢出**     | localStorage 满后静默丢弃      |

> 用户原声: "Lost thousands of tabs and years of collected data"

### P1: 无跨设备同步 ⭐⭐⭐⭐

- 手机 ↔ 电脑无法共享标签
- 多设备场景无解
- 用户被迫手动导出/导入

### P2: 性能问题 ⭐⭐⭐

- 恢复大量标签时卡顿
- 页面列表过长时 UI 变慢
- 开发者承认 "restoring thousands of tabs simultaneously can lead to performance issues"

### P3: 功能单一 ⭐⭐

- 无分组/文件夹
- 无搜索功能
- 无标签预览

---

## 🔴 Toby 核心痛点

### P0: 付费墙 ⭐⭐⭐⭐⭐

| 问题           | 描述                                        |
| -------------- | ------------------------------------------- |
| **$40/年订阅** | 2024 年从免费转付费                         |
| **用户愤怒**   | "exploitative pricing" "reneged on promise" |
| **功能锁定**   | 免费版功能受限                              |

### P1: 信任危机 ⭐⭐⭐

- 曾承诺永久免费
- 用户大量流失至替代品

---

## 🟢 竞品分析

| 扩展                 | 优势                   | 劣势          |
| -------------------- | ---------------------- | ------------- |
| **Workona**          | 工作区/云同步/自动挂起 | 复杂/付费     |
| **Session Buddy**    | 会话管理/崩溃恢复      | 无云同步      |
| **Tab Manager Plus** | 可视化/去重            | 功能有限      |
| **Tabwise**          | AI 自动分类            | 新产品/未验证 |
| **Side Space**       | 垂直标签/AI 分组       | 仅 2025 新品  |

---

## 💡 HALO 差异化方向

### 核心卖点

| 痛点     | HALO 方案                                           |
| -------- | --------------------------------------------------- |
| 数据丢失 | **本地 + 云双备份** (IndexedDB + 可选 Google Drive) |
| 无同步   | **跨设备同步** via chrome.storage.sync              |
| 付费墙   | **永久免费 + 开源**                                 |
| 功能单一 | **AI 模糊搜索** + 分组 + 预览                       |

### MVP 功能 (W5-6)

```
v0.2 标签管理
├─ 一键保存所有标签
├─ 分组/文件夹管理
├─ 模糊搜索 (Fuse.js)
├─ 自动备份 (每日导出)
├─ 跨设备同步 (chrome.storage.sync)
└─ 恢复确认 (防误操作)
```

### 技术选型

```
存储: IndexedDB (大容量) + chrome.storage.sync (同步)
搜索: Fuse.js (轻量模糊匹配)
备份: 自动 JSON 导出 + 可选 Google Drive API
```

---

## 📝 用户原声

> "Lost all my tabs after Chrome update, years of research gone" — Reddit

> "OneTab has no sync, I need to manually export every week" — Chrome Store

> "Toby went from free to $40/year, feels like betrayal" — Reddit 2024

> "Workona is great but too complex for simple tab saving" — Reddit

---

## 🔗 流失用户去向

用户在 2024 寻找的替代品:

- Raindrop.io
- TabXpert
- BrainTool
- Tabox
- SessionBlocks
- GeekTabs

**机会**: 这些用户正在积极寻找替代品，HALO 可精准获客
