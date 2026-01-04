# HALO 规划 (v2.6.2)

> **定位**: 离线优先开发者/效率工具箱 | **对标**: DevToys, IT-Tools, He3
> **状态**: 90 Tools (86 User + 4 System) | SidePanel | Local First

## 📊 工具库概览

- **System (4)**: settings, module-store, permissions, resource-monitor
- **Core (10)**: qrcode, color-picker, json-formatter, hash, uuid, timestamp, url...
- **Dev (37)**: userscripts(Pro), regex, network, jwt, diff, sql, protobuf, dom, api-tester...
- **Efficiency (13)**: smooth-scroll(v2), tabs, clipboard(intent), pomodoro, session...
- **Sec/Media/Browser (26)**: password, totp, image, reader, translate, bilibili-plus(SaaT), chatgpt-wide(SaaT), hover-zoom, extension-manager...

## 📜 变更历史

### v2.6.2 Resource Monitor SSOT (2026-01-04)

- **Manifest-Driven**: 后台消耗声明在各自 manifest.json `background` 字段
- **Source Annotation**: sourceFile/Line/Detail 精确标注
- **System Core**: 监控 background.ts, content.ts, sidepanel-init.ts
- **UI**: TOOL/SYS/SCRIPT 分类标签 + 通用 i18n key

### v2.6.1 Performance (2026-01-03)

- **Polling → Event**: 消除所有 setInterval，改纯事件驱动
- **Visibility Pause**: 定时器面板不可见时自动暂停

### v2.6.0 Resource Monitor (2026-01-03)

- **System Panel**: 集中展示 Active Services (后台+脚本)
- **Entry**: Header ⚡ 图标入口

### v2.5.0 Script Store (2026-01-03)

- **SaaT Refactor**: 独立 `src/scripts/` 目录 + 三路扫描
- **Fork Mode**: 编辑官方脚本自动 Fork

### v2.4.x i18n + SaaT (2026-01-03)

- **SaaT**: `toolType:'script'` 伪工具 + saat-service.ts
- **i18n**: Flat Source + Nested Runtime 统一架构
- **首批 SaaT**: bilibili-plus(JS), chatgpt-wide(CSS)

---

## 🚧 进行中任务

### 架构 SSOT

- 🔥 **Taxonomy SSOT**: `kernel/registry/taxonomy.ts` 统一分类定义
- 🔥 **Permission SSOT**: Manifest `permissions[]` → 构建生成 PERMISSION_USAGE_MAP

### 功能交付

- **UserScripts Pro**: i18n SSOT 收尾
- **Official Recipes**: 内置高频脚本一键安装

---

## 📅 路线图

### Phase 10-12: Browser/Security (P1)

- ✅ SaaT: bilibili-plus, chatgpt-wide
- ✅ Browser Native: hover-zoom, extension-manager
- ⏳ Security: checksum, ssl-check, csp-analyzer

### Phase 13-15: Pro/AI (P2)

- AI: ocr, ai-chat, code-explain
- Pro: websocket, graphql, media-sniffer

---

## 🏗️ 技术原则

1. **SSOT**: 定义/类型/UI 源于单一事实 (Manifest/Registry)
2. **Atomic**: 单工具 ≤200 行，独立生命周期
3. **Isolation**: System 与 User 物理/逻辑隔离
4. **Local First**: 零上传，数据本地处理

## 📂 关联

- [架构文档](docs/architecture.md)
- [开发规则](../../docs/ai-rules.md)
