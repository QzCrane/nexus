# HALO 功能规划 (合并版)

> **定位**: 离线优先的开发者与效率工具箱
> **竞品对标**: DevToys, IT-Tools, He3, CyberChef

## 📊 功能状态 (59/100+)

### ✅ 已完成 (59)

| 分类       | 工具                                                                                                                                                                                                                                                             |
| :--------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **通用**   | qrcode, color-picker, ruler, json-formatter, outline, clipboard, settings                                                                                                                                                                                        |
| **开发**   | regex, base64, hash, uuid, timestamp, url, crypto, mock-data, network, cron, html-entity, code-formatter, yaml, number-base, markdown, http-status, ip-lookup, font-inspector, xml-formatter, csv-viewer, headers-viewer, tech-stack, storage-editor, user-agent |
| **效率**   | smooth-scroll, tabs, screenshot, pdf, text-tools, lorem-ipsum, diff, unit-converter, sticky-notes, pomodoro, timer, shortcuts, todo-list, text-to-speech                                                                                                         |
| **安全**   | password-gen, totp                                                                                                                                                                                                                                               |
| **媒体**   | image-tools, exif-reader, color-palette                                                                                                                                                                                                                          |
| **浏览器** | archive, userscripts, permissions, cookie-manager, reader-mode, bookmark-manager, history-search, table-extractor                                                                                                                                                |
| **系统**   | module-store                                                                                                                                                                                                                                                     |

---

## 🔜 阶段 9: 编解码增强 (P0)

> 对标 CyberChef 链式操作

| 工具            | 功能                            | 复杂度 |
| :-------------- | :------------------------------ | :----: |
| **gzip**        | Gzip 压缩/解压                  |   低   |
| **punycode**    | Punycode ↔ Unicode (国际化域名) |   低   |
| **morse**       | 摩尔斯电码编解码                |   低   |
| **jwt-decoder** | JWT 解析/验证 (无签名)          |   中   |
| **ssl-cert**    | SSL 证书解析 (PEM/DER)          |   中   |
| **rot13**       | ROT13/ROT47 简单替换            |   低   |
| **xor**         | XOR 加解密 + 暴力破解           |   中   |
| **hex-dump**    | 十六进制转储查看器              |   中   |

---

## 🔜 阶段 10: 数据转换增强 (P0)

| 工具              | 功能                         | 复杂度 |
| :---------------- | :--------------------------- | :----: |
| **json-to-csv**   | JSON 数组 → CSV              |   低   |
| **csv-to-json**   | CSV → JSON 对象              |   低   |
| **json-to-yaml**  | JSON → YAML (已有 yaml 工具) |   -    |
| **sql-formatter** | 专业 SQL 格式化              |   中   |
| **json-path**     | JSONPath 查询                |   中   |
| **protobuf**      | Protobuf 解码 (Base64→JSON)  |   高   |
| **avro**          | Avro → JSON                  |   高   |

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
