# HALO 功能规划 (v2.3.0)

> **定位**: 离线优先的开发者与效率工具箱 | **对标**: DevToys, IT-Tools, He3
> **核心状态**: 83 User Tools + 3 System Tools | SidePanel Architecture | Local First

## 📊 现有工具库

- **System (3)**: settings, module-store, permissions (系统级组件，不进入工具列表)
- **Core (10)**: qrcode, color-picker, json-formatter, hash, uuid, timestamp, url...
- **Dev (37)**: userscripts, regex, network, jwt, diff, sql, protobuf, dom, api-tester...
- **Efficiency (13)**: smooth-scroll, tabs, clipboard, pomodoro, session-manager...
- **Sec/Media/Browser (17)**: password-gen, image-tools, reader-mode, translate...

## 📜 变更历史 (Archives)

### v2.2.0 Global Persistence & Serviceization (2026-01-02)

- **Global State**: `useToolState` 原子化存储，支持跨窗口同步与自动防抖。
- **Quality**: Playwright UI Automation + Safe Storage Timeouts.
- **Smart Features**: `useClipboardIntent` 智能剪贴板意图识别.

## 🚧 核心任务 (SIP - v2.3.0)

### 架构统一与系统隔离 (Unified SSOT & System Isolation)

目标: 所有的软件定义、类型、UI 都必须有单一事实来源 (Single Source of Truth)。

- 🔥 **System Isolation (系统隔离)**:

  - 规则: `settings`, `module-store`, `permissions` 必须标记为 `system: true`。
  - 实现: 构建时将它们从 `TOOL_REGISTRY` 分离到 `SYSTEM_REGISTRY`，确保其严禁出现在常规工具列表或搜索结果中（除非明确搜系统设置）。
  - UI: 仅通过 Header / Global Actions 进入。

- 🔥 **Taxonomy SSOT (分类定义的单一来源)**:

  - 现状: 分类散落在 `types.ts` 和 `ToolManager`。
  - 目标: 建立 `kernel/registry/taxonomy.ts` 统一管理 ID、Icon、排序、类型定义。UI 必须消费此配置。

- 🔥 **Permission SSOT (权限定义的单一来源)**:
  - 现状: 权限依赖写在 Kernel。
  - 目标: 依赖回归 Manifest (`permissions: []`) -> 构建脚本生成 `PERMISSION_USAGE_MAP` -> 内核消费。

### 功能交付 (Feature Delivery)

- **UserScripts Pro**: 依照 v2.3.0 架构标准完成收尾 (i18n SSOT, Layout Fix).

---

## 📅 对齐路线图 (Roadmap)

### Phase 10-12: 浏览器/安全/编解码 (P1)

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

- [架构图谱](docs/architecture-registry.md) | [开发规则](../../docs/ai-rules.md)
