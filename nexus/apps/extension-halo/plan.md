# HALO 功能规划 (v2.3.0)

> **定位**: 离线优先的开发者与效率工具箱 | **对标**: DevToys, IT-Tools, He3
> **核心状态**: 84 User Tools + 3 System Tools | SidePanel Architecture | Local First

## 📊 现有工具库

- **System (3)**: settings, module-store, permissions (系统级组件，不进入工具列表)
- **Core (10)**: qrcode, color-picker, json-formatter, hash, uuid, timestamp, url...
- **Dev (37)**: userscripts, regex, network, jwt, diff, sql, protobuf, dom, api-tester...
- **Efficiency (13)**: smooth-scroll, tabs, clipboard, pomodoro, session-manager...
- **Sec/Media/Browser (19)**: password-gen, image-tools, reader-mode, translate, bilibili-plus, chatgpt-wide...

## 📜 变更历史 (Archives)

### v2.2.0 Global Persistence & Serviceization (2026-01-02)

- **Global State**: `useToolState` 原子化存储，支持跨窗口同步与自动防抖。
- **Quality**: Playwright UI Automation + Safe Storage Timeouts.
- **Smart Features**: `useClipboardIntent` 智能剪贴板意图识别.

### v2.3.0 UserScripts Pro Architecture (2026-01-02)

- **chrome.userScripts API**: 真正的 `document_start` MAIN world 注入 (Chrome 120+).
- **registry.ts**: 动态注册/注销脚本，storage 变化自动同步.
- **Block Space Scroll**: 两全其美方案 - 阻止滚动 + 手动控制视频播放/暂停.
- **Smooth Scroll Fix**: 解决视频/下拉框按键冲突 (Smart Input Detection).
- **i18n Architecture Refactor**: ✅ 去中心化翻译资源 (Tools/System Self-contained) + 自动聚合.

### v2.3.1 i18n Completion (2026-01-03)

- **Full Internationalization**: Refactored 10+ core/dev tools (Protobuf, Network, Crypto, Pomodoro...) to use i18n keys.
- **Locale SSOT**: All tool locales now reside in `src/tools/<name>/locales/{en,zh}.ts`.

### v2.4.0 SaaT Architecture (2026-01-03)

- **Script-as-a-Tool (SaaT)**: Registry 支持 `toolType: 'script'` 伪工具，无需 React Panel。
- **Dual Discovery**: `generate-tool-registry.mjs` 支持 Panel (panel.tsx) 和 Script (script.js/css) 两种发现模式。
- **SaaT Service**: `saat-service.ts` 管理脚本工具启停，复用 userScripts 引擎。
- **First SaaT Tools**: `bilibili-plus` (JS, B 站增强), `chatgpt-wide` (CSS, AI 宽屏)。
- **UI Adaptation**: 脚本工具点击触发 Toggle 而非面板导航。

## 🚧 核心任务 (SIP - v2.3.0)

### 架构统一与系统隔离 (Unified SSOT & System Isolation)

目标: 所有的软件定义、类型、UI 都必须有单一事实来源 (Single Source of Truth)。

- 🔥 **System Isolation (系统隔离)**:

  - 规则: `settings`, `module-store`, `permissions` 必须标记为 `system: true`。
  - UI: 仅通过 Header / Global Actions 进入。

- ✅ **Script-as-a-Tool (SaaT) 伪工具架构**: (v2.4.0)

  - 目标: 让脚本在 UI 上表现得像独立工具 (Script Tool)，拥有独立图标、搜索入口和启停开关。
  - 实现: Registry 支持 `toolType: 'script'`，生成脚本自动发现 script.js/css。
  - 交互: 主页点击直接 Toggle 启/停，底层调用 `userscripts` 引擎。
  - 首批: ✅ `bilibili-plus` (JS), ✅ `chatgpt-wide` (CSS).

- 🔥 **Taxonomy SSOT (分类定义的单一来源)**:

  - 现状: 分类散落在 `types.ts` 和 `ToolManager`。
  - 目标: 建立 `kernel/registry/taxonomy.ts` 统一管理 ID、Icon、排序、类型定义。UI 必须消费此配置。

- 🔥 **Permission SSOT (权限定义的单一来源)**:
  - 现状: 权限依赖写在 Kernel。
  - 目标: 依赖回归 Manifest (`permissions: []`) -> 构建脚本生成 `PERMISSION_USAGE_MAP` -> 内核消费。

### 功能交付 (Feature Delivery)

- **UserScripts Pro**: 依照 v2.3.0 架构标准完成收尾 (i18n SSOT, Layout Fix).
- **Official Script Recipes**: 在 UserScripts 中内置"B 站增强"、"ChatGPT 宽屏"等高频脚本的一键安装，避免将它们异化为独立工具。

---

## 📅 对齐路线图 (Roadmap)

### Phase 10-12: 浏览器/安全/编解码 (P1)

- **SaaT Scripts**: ✅ `bilibili-plus`, ✅ `chatgpt-wide` (作为 SaaT 验证).
- **Browser Native**: ✅ `hover-zoom` (浮图秀 - declarativeNetRequest 防盗链), ✅ `extension-manager` (插件管家 - 分组/权限透视).
- **Security**: `checksum`, `ssl-check`, `csp-analyzer`, `random-gen`.
- **Browser**: `translate` (API), `page-annotate`, `download-manager`, `tab-group`.

### Phase 13-15: 专业领域与 AI (P2)

- **AI**: `ocr`, `ai-chat`, `code-explain`.
- **Pro**: `websocket`, `graphql`, `media-sniffer`.

---

## 🏗️ 技术原则

1. **SSOT**: 定义、类型、UI 必须源于单一事实 (Manifest / Registry).
2. **Atomic**: 单个工具 ≤200 行，独立生命周期。
3. **Isolation**: 系统插件与用户插件物理/逻辑隔离。
4. **Local First**: 零上传，数据本地处理。

## 📂 关联

- [开发规则](../../docs/ai-rules.md)
