# HALO 市场调研汇总 (2024-2025)

> **目标**: 识别头部扩展痛点 → 设计 HALO 差异化方案  
> **调研日期**: 2025-12-28

---

## 📊 调研覆盖

| 目标扩展             | 用户量 | 核心痛点        | 调研文档                                        |
| -------------------- | ------ | --------------- | ----------------------------------------------- |
| Dark Reader          | 6M+    | 性能/兼容       | [dark-reader](./market-research-dark-reader.md) |
| OneTab               | 2M+    | 数据丢失/无同步 | [onetab](./market-research-onetab.md)           |
| Toby                 | 1M+    | 付费墙          | [onetab](./market-research-onetab.md)           |
| Lightshot            | 10M+   | 隐私泄露        | [lightshot](./market-research-lightshot.md)     |
| QR 扩展              | 5M+    | 隐私/钓鱼       | [halo-extra](./market-research-halo-extra.md)   |
| SmoothScroll         | 500k+  | 性能问题        | [halo-extra](./market-research-halo-extra.md)   |
| Clipboard History    | 500k+  | 隐私泄露        | [halo-extra](./market-research-halo-extra.md)   |
| StayFocusd/BlockSite | 10M+   | 易绕过/付费     | [halo-extra](./market-research-halo-extra.md)   |

---

## 🎯 HALO 顶替策略

### W1-2: 深色模式 (顶替 Dark Reader)

| 痛点 | Dark Reader | HALO                    |
| ---- | ----------- | ----------------------- |
| 性能 | 500-2000ms  | **<50ms**               |
| 白闪 | 有          | **无** (document_start) |
| CPU  | 高          | **低** (纯 CSS)         |
| 配置 | 复杂        | **一键**                |

**技术**: CSS filter + document_start 早期注入

### W5-6: 标签管理 (顶替 OneTab/Toby)

| 痛点     | OneTab | Toby   | HALO         |
| -------- | ------ | ------ | ------------ |
| 数据丢失 | ❌     | ✅     | **双备份**   |
| 同步     | ❌     | ✅     | **免费同步** |
| 价格     | 免费   | $40/年 | **永久免费** |
| AI 搜索  | ❌     | ❌     | **✅**       |

**技术**: IndexedDB + chrome.storage.sync + Fuse.js

### W6: 截图 (顶替 Lightshot)

| 痛点 | Lightshot   | HALO          |
| ---- | ----------- | ------------- |
| 隐私 | ❌ 公开上传 | **100% 本地** |
| 批注 | 基础        | **丰富**      |
| OCR  | ❌          | **本地 OCR**  |

### 第三阶段: 规模期 (2026)

```text
目标: DAU 500k+
策略: 企业版 + API 授权
预期收入: $50k-100k/年
```

---

## 🎯 Pro 功能规划

### SPECTRA Pro

| 功能       | 价值         |
| ---------- | ------------ |
| 人声分离   | 本地 AI 处理 |
| 1080p 导出 | 视频增强     |
| 预设同步   | 跨设备       |
| 无限标记   | 时间点书签   |

### HALO Pro

| 功能         | 价值         |
| ------------ | ------------ |
| 主题自定义   | 颜色/对比度  |
| 无限标签组   | 工作空间     |
| AI 模糊搜索  | 快速查找     |
| 云备份       | Google Drive |
| OCR 文本提取 | 截图转文字   |

### CORTEX Pro

| 功能          | 价值       |
| ------------- | ---------- |
| 高级 AI 模型  | GPT-4 级别 |
| 批量处理      | 多文件摘要 |
| 自定义 Prompt | 工作流     |

---

## 🔥 痛点频次排名

| 排名 | 痛点                 | 涉及扩展             | 用户情绪 |
| ---- | -------------------- | -------------------- | -------- |
| 1    | **性能拖慢浏览器**   | Dark Reader          | 愤怒     |
| 2    | **数据丢失无法恢复** | OneTab               | 绝望     |
| 3    | **隐私/安全泄露**    | Lightshot            | 恐惧     |
| 4    | **付费墙/涨价**      | Toby                 | 愤怒     |
| 5    | **功能过于复杂**     | Dark Reader, Workona | 困惑     |

---

## 💡 HALO 核心定位

```
HALO = 轻量 + 隐私 + 免费 + 开源

口号: "Zero upload. Zero tracking. Zero cost."
```

### 差异化护城河

| 层级    | 能力                      |
| ------- | ------------------------- |
| L3 信任 | 开源 + 零遥测 + 最小权限  |
| L2 性能 | CSS 注入 < 50ms           |
| L1 隐私 | 100% 本地处理             |
| L0 功能 | 深色 + 标签 + 截图 一站式 |

---

## 📅 交付路线

```
W1-2: HALO v0.1 深色模式
W3-4: SPECTRA v1.1 迭代 (等审核)
W5-6: HALO v0.2 标签管理 + 截图
W7-8: CORTEX v0.1 听歌识曲
```

---

## 🔗 调研数据源

- Chrome Web Store 1-2★ 评论
- Firefox Add-ons 负面评论
- GitHub Issues (darkreader: 1360 open)
- Reddit: r/chrome, r/firefox, r/privacy
- 安全报告: Missouri S&T, joindeleteme.com
- 产品比较: Workona, alternativeto.net

### 📈 2024-2025 流行趋势补充

根据趋势分析，建议增加以下高需求功能：

| 功能            | 用户需求 | 竞争情况         | 推荐指数   | 纳入 HALO |
| --------------- | -------- | ---------------- | ---------- | :-------: |
| **阅读模式**    | 高       | Reader View 简陋 | ⭐⭐⭐⭐⭐ |    ✅     |
| **快捷便签**    | 中       | 与 Notion 竞争   | ⭐⭐       |    ✅     |
| **白噪音/专注** | 高       | Noisli 付费      | ⭐⭐⭐⭐   |  考虑中   |
| **页面翻译**    | 高       | 竞争激烈         | ⭐⭐       |    ❌     |
| **页面录制**    | 中       | Loom/Scribe 复杂 | ⭐⭐⭐     |    ❌     |
| **下载管理**    | 中       | Chrome 内置弱    | ⭐⭐⭐     |    ❌     |

**新增功能定位**:

- **阅读模式**: 简化页面，去广告，提供纯净阅读体验 (P2)
- **快捷便签**: 页面级轻量笔记，与截图功能联动 (P2)
