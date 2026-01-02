# HALO 功能规划 (v2.0.0)

> **定位**: 离线优先的开发者与效率工具箱
> **竞品对标**: DevToys, IT-Tools, He3, CyberChef

## 📊 功能状态 (83 tools + 3 system)

### ✅ 已完成 (85)

Core (13): qrcode, screenshot, color-picker, ruler, json-formatter, base64, hash, uuid, timestamp, url, module-store, settings, permissions
Dev (37): regex, outline, crypto, network, mock-data, userscripts, yaml, diff, number-base, text-tools, lorem-ipsum, markdown, cron, html-entity, code-formatter, http-status, csv-viewer, ip-lookup, font-inspector, xml-formatter, headers-viewer, tech-stack, storage-editor, user-agent, gzip, jwt-decoder, morse, json-to-csv, sql-formatter, json-path, punycode, rot13, csv-to-json, hex-dump, ssl-cert, xor, protobuf, dom-selector, **code-snippets**, **api-tester**
Efficiency (13): smooth-scroll, tabs, pdf, clipboard, unit-converter, sticky-notes, pomodoro, timer, shortcuts, todo-list, text-to-speech, emoji-picker, session-manager
Security (5): password-gen, totp, checksum, random-gen, subresource, csp-analyzer
Media (4): image-tools, exif-reader, color-palette, **media-sniffer**
Browser (8): archive, cookie-manager, reader-mode, bookmark-manager, history-search, table-extractor, page-annotate, translate, tab-group

---

## 🏗️ 架构优化 (2026-01-01 完成)

### 自动生成注册表系统

- ✅ 创建 `scripts/generate-tool-registry.mjs` → 扫描 `tools/*/manifest.json`
- ✅ 自动生成 `kernel/registry/_generated.ts` (工具元数据)
- ✅ 自动生成 `components/_generated-tool-loader.ts` (lazy import 映射)
- ✅ 重写 `module-registry.ts` 消费生成数据 (145 行 → 80 行, -45%)
- ✅ 重写 `lazy-tool-loader.tsx` (173 行 → 80 行, -54%)
- ✅ 删除冗余 `tools-data-*.ts` 文件 (5 个)

### 核心体验与性能优化 (2026-01-01 完成)

- ✅ **多语境搜索**: 支持中英双语、ID、拼音(全拼/简拼) 检索
- ✅ **响应式 i18n**: 切换语言全局实时生效，包含 **Permissions Panel** 深度国际化
- ✅ **权限管理收口**: `permissions` 提级为系统工具，集成至页眉
- ✅ **平滑滚动增强**: 增加主开关与预设配置，对标 SmoothScroll Pro
- ✅ **Dock & UX Polishing**:
  - **macOS Interaction**: 线性缩放感应区域，脱离原始高度立即缩小。
  - **Zero-Block Hit Area**: 采用 Layered `pointer-events` 模式，Dock 不再遮挡顶部栏点击。
  - **True Centering**: 移除冲突的动态 Padding，改用 CSS `margin: auto` 实现完美居中。
  - **Dynamic Engine Badge**: 实时追踪 SmoothScroll, UserScripts, Clipboard 运行状态。
- ✅ **Performance Overhaul**:
  - **Centralized Engine Status**: 实现 `EngineStatusProvider` 广播机制，减少 80+ 个冗余监听器。
  - **Zero-Copy Visualizer**: 频谱数据传输移除 `Array.from`，采用 TypedArray 直接映射。
  - **Lifecycle Safety**: 引入 `detachNode` 机制，在 DOM 移除时自动销毁节点，确保零内存泄漏。
  - **Independent Public Sync**: 重构同步脚本，支持 `spectra-public`与 `halo-public` 独立分发。
  - **World-Class Refactoring**: `LauncherToolItem` 与 `WebAudioController` 函数行数降至 150 左右。

**新增工具流程**: 创建 `manifest.json` + `panel.tsx` → `pnpm build` 自动注册

### UI 自动化测试框架 (2026-01-02 完成)

- ✅ **Playwright 测试脚本**: `test/ui-playwright.spec.ts` - 持久化上下文 + 截图
- ✅ **安全 Storage 包装器**: `kernel/core/safe-storage.ts` - 超时机制防止挂起
- ✅ **i18n 初始化超时**: 2 秒超时，确保测试环境不阻塞
- ✅ **ModuleManager 内存模式**: IndexedDB 超时后自动降级到内存模式

**运行测试**: `pnpm test:playwright` → 截图输出到 `test/screenshots/`

### 核心工具功能大版本升级 (2026-01-02 完成 - v2.1.0)

- 🔥 **Hash Tool**: 增加 MD5, HMAC 支持，多算法结果同时展示，自动识别并验证哈希。
- 🔥 **Color Picker**: 增加 CMYK 转换，WCAG 2.1 对比度检查 (AA/AAA 评级)。
- 🔥 **QR Code**: 增加 Logo 嵌入、自定义颜色、SVG/PNG 双格式导出。
- 🔥 **JSON Formatter**: 增加 Tree View (可视化树)、递归排序、一键下载。
- 🔥 **Base64 Tool**: 增加图片 DataURL 预览、二进制下载、自动双向转换。
- 🔥 **Timestamp**: 增加全球 5 大时区实时转换、相对时间计算。
- 🔥 **Password Gen**: 增加批量生成 (10x)、强度实时分析、布局优化。
- 🔥 **UUID Gen**: 增加 v1 (时间戳) 支持, v7/ULID 逻辑优化。
- ✅ **Ergonomic Design**: 实现“全信息展开”、“零交互完成”设计理念，击败 90% 单一功能竞品。
- ✅ **Code Refactoring**: `timestamp`, `uuid`, `hash` 面板代码重构至 150 行以内，符合 Clean Code 标准。

### 全局持久化状态架构 (2026-01-02 完成 - v2.2.0)

- ✅ **`useToolState` Hook**: 核心 Hook 实现，支持 JSON 自动序列化、多窗口同步、300ms 防抖写入。支持函数式初始化。
- ✅ **原子化隔离**: 每个工具状态独立前缀 `halo_tool_state_${id}`，确插件增删不影响全局存储。
- ✅ **首批核心重构 (83/83)**:
- ✅ **智能意图触发**: `useClipboardIntent` 自动识别剪切板类型（JWT/JSON/URL/HEX）并引导用户使用对应工具。

---

## 🔜 阶段 10: 编解码增强 (P1)

---

## 🔜 阶段 11: 安全工具增强 (P1)

工具: 功能: 复杂度
**checksum**: 文件校验和验证: 低
**ssl-check**: 检查网站 SSL 证书: 中
**csp-analyzer**: CSP 策略分析: 中
**subresource**: SRI (子资源完整性) 生成: 低
**random-gen**: 安全随机数生成器: 低

---

## 🔜 阶段 12: 浏览器增强 (P1)

工具: 功能: 复杂度
**translate**: 网页翻译 (Google/DeepL API): 高
**page-annotate**: 网页标注/涂鸦: 高
**download-manager**: 下载管理 + 批量下载: 高
**tab-group**: 标签组管理: 中
**session-manager**: 会话保存/恢复: 中
**dom-selector**: 点击生成 CSS/XPath 选择器: 中

---

## 🔜 阶段 13: AI 增强 (P2 长期)

工具: 功能: 复杂度
**ocr**: 图片文字识别 (Tesseract.js): 高
**ai-chat**: AI 助手 (OpenAI/Claude API): 高
**code-explain**: 代码解释 (AI): 高
**summarize**: 网页内容摘要 (AI): 高

---

## 🔜 阶段 14: 开发者专业 (P2)

工具: 功能: 复杂度
**api-tester**: 简易 Postman (REST 测试): 高
**websocket**: WebSocket 调试: 高
**graphql**: GraphQL 查询测试: 高
**code-snippets**: 代码片段管理: 中
**color-blind-sim**: 色盲模拟器: 中
**media-sniffer**: 媒体资源嗅探: 中

---

## 🔜 阶段 15: 其他实用 (P2)

工具: 功能: 复杂度
**reading-progress**: 阅读进度记录: 低
**notes-sync**: 便签云同步: 高
**rss-reader**: 简易 RSS 阅读器: 中
**calendar**: 简易日历/日期选择: 低
**qr-scan-camera**: 摄像头扫描二维码: 中
**emoji-picker**: Emoji 选择器 + 复制: 低

---

## 🏗️ 技术原则

1. **Local First**: 所有数据本地处理, 不上传
2. **Lazy Load**: 每个工具独立打包, 按需加载
3. **Atomic Module**: 每个工具 ≤200 行, 可独立安装/卸载
4. **Zero Dependencies**: 尽量用 Web API 原生实现
5. **Smart Detection**: 剪贴板智能识别 (类似 DevToys)
6. **Efficiency First**: 中心化监听，零拷贝传输，自动资源回收

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
