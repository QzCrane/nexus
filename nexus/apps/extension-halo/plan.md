# HALO 功能规划 (v1.4.0)

> **定位**: 离线优先的开发者与效率工具箱
> **竞品对标**: DevToys, IT-Tools, He3, CyberChef

## 📊 功能状态 (80 tools + 2 system)

### ✅ 已完成 (82)

| 分类           | 工具数 | 列表                                                                                                                                                                                                                                                                                                                                                                                                                              |
| :------------- | :----: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core**       |   12   | qrcode, screenshot, color-picker, ruler, json-formatter, base64, hash, uuid, timestamp, url, module-store, settings                                                                                                                                                                                                                                                                                                               |
| **Dev**        |   34   | regex, outline, crypto, network, mock-data, userscripts, yaml, diff, number-base, text-tools, lorem-ipsum, markdown, cron, html-entity, code-formatter, http-status, csv-viewer, ip-lookup, font-inspector, xml-formatter, headers-viewer, tech-stack, storage-editor, user-agent, gzip, jwt-decoder, morse, json-to-csv, sql-formatter, json-path, punycode, rot13, csv-to-json, hex-dump, ssl-cert, xor, protobuf, dom-selector |
| **Efficiency** |   14   | smooth-scroll, tabs, pdf, clipboard, permissions, unit-converter, sticky-notes, pomodoro, timer, shortcuts, todo-list, text-to-speech, emoji-picker, session-manager                                                                                                                                                                                                                                                              |
| **Security**   |   5    | password-gen, totp, checksum, random-gen, subresource, csp-analyzer                                                                                                                                                                                                                                                                                                                                                               |
| **Media**      |   3    | image-tools, exif-reader, color-palette                                                                                                                                                                                                                                                                                                                                                                                           |
| **Browser**    |   8    | archive, cookie-manager, reader-mode, bookmark-manager, history-search, table-extractor, page-annotate, translate, tab-group                                                                                                                                                                                                                                                                                                      |

---

## 🏗️ 架构优化 (2026-01-01 完成)

### 自动生成注册表系统

- ✅ 创建 `scripts/generate-tool-registry.mjs` → 扫描 `tools/*/manifest.json`
- ✅ 自动生成 `kernel/registry/_generated.ts` (工具元数据)
- ✅ 自动生成 `components/_generated-tool-loader.ts` (lazy import 映射)
- ✅ 重写 `module-registry.ts` 消费生成数据 (145 行 → 80 行, -45%)
- ✅ 重写 `lazy-tool-loader.tsx` (173 行 → 80 行, -54%)
- ✅ 删除冗余 `tools-data-*.ts` 文件 (5 个)

**新增工具流程**: 创建 `manifest.json` + `panel.tsx` → `pnpm build` 自动注册

---

## 🔜 阶段 9: 技术债清理 (P0)

| 任务                      | 当前状态 | 目标    |
| :------------------------ | :------- | :------ |
| `LauncherLayout.tsx` 拆分 | 299 行   | ≤200 行 |
| `ClassicLayout.tsx` 拆分  | 182 行   | ≤150 行 |
| `SidePanel.tsx` 优化      | 158 行   | ≤150 行 |

---

## 🔜 阶段 10: 编解码增强 (P1)

---

## 🔜 阶段 11: 安全工具增强 (P1)

| 工具             | 功能                    | 复杂度 |
| :--------------- | :---------------------- | :----: |
| **checksum**     | 文件校验和验证          |   低   |
| **ssl-check**    | 检查网站 SSL 证书       |   中   |
| **csp-analyzer** | CSP 策略分析            |   中   |
| **subresource**  | SRI (子资源完整性) 生成 |   低   |
| **random-gen**   | 安全随机数生成器        |   低   |

---

## 🔜 阶段 12: 浏览器增强 (P1)

| 工具                 | 功能                        | 复杂度 |
| :------------------- | :-------------------------- | :----: |
| **translate**        | 网页翻译 (Google/DeepL API) |   高   |
| **page-annotate**    | 网页标注/涂鸦               |   高   |
| **download-manager** | 下载管理 + 批量下载         |   高   |
| **tab-group**        | 标签组管理                  |   中   |
| **session-manager**  | 会话保存/恢复               |   中   |
| **dom-selector**     | 点击生成 CSS/XPath 选择器   |   中   |

---

## 🔜 阶段 13: AI 增强 (P2 长期)

| 工具             | 功能                        | 复杂度 |
| :--------------- | :-------------------------- | :----: |
| **ocr**          | 图片文字识别 (Tesseract.js) |   高   |
| **ai-chat**      | AI 助手 (OpenAI/Claude API) |   高   |
| **code-explain** | 代码解释 (AI)               |   高   |
| **summarize**    | 网页内容摘要 (AI)           |   高   |

---

## 🔜 阶段 14: 开发者专业 (P2)

| 工具                | 功能                     | 复杂度 |
| :------------------ | :----------------------- | :----: |
| **api-tester**      | 简易 Postman (REST 测试) |   高   |
| **websocket**       | WebSocket 调试           |   高   |
| **graphql**         | GraphQL 查询测试         |   高   |
| **code-snippets**   | 代码片段管理             |   中   |
| **color-blind-sim** | 色盲模拟器               |   中   |
| **media-sniffer**   | 媒体资源嗅探             |   中   |

---

## 🔜 阶段 15: 其他实用 (P2)

| 工具                 | 功能                | 复杂度 |
| :------------------- | :------------------ | :----: |
| **reading-progress** | 阅读进度记录        |   低   |
| **notes-sync**       | 便签云同步          |   高   |
| **rss-reader**       | 简易 RSS 阅读器     |   中   |
| **calendar**         | 简易日历/日期选择   |   低   |
| **qr-scan-camera**   | 摄像头扫描二维码    |   中   |
| **emoji-picker**     | Emoji 选择器 + 复制 |   低   |

---

## 🏗️ 技术原则

1. **Local First**: 所有数据本地处理, 不上传
2. **Lazy Load**: 每个工具独立打包, 按需加载
3. **Atomic Module**: 每个工具 ≤200 行, 可独立安装/卸载
4. **Zero Dependencies**: 尽量用 Web API 原生实现
5. **Smart Detection**: 剪贴板智能识别 (类似 DevToys)

---

## 📋 优先级实现顺序

### v1.2 (编解码增强) - 8 个

gzip, punycode, morse, jwt-decoder, ssl-cert, rot13, xor, hex-dump

### v1.3 (数据转换) - 5 个

json-to-csv, csv-to-json, sql-formatter, json-path, protobuf

### v1.4 (安全+浏览器) - 10 个

checksum, ssl-check, csp-analyzer, subresource, random-gen, translate, page-annotate, dom-selector, session-manager, tab-group

### v2.0 (AI+专业) - 10 个

ocr, ai-chat, code-explain, summarize, api-tester, websocket, graphql, code-snippets, color-blind-sim, media-sniffer

---

## 📂 关联文档

- [架构规范](docs/architecture.md)
- [开发规则](../../docs/ai-rules.md)
