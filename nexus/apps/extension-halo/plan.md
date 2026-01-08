# HALO 规划 (v2.6)

> 定位: 离线优先开发者/效率工具箱 | 对标: DevToys, IT-Tools, He3
> 状态: 84 User + 3 System Tools | SidePanel | Local First

## 工具库

System(3): settings, module-store, permissions
Core(10): qrcode, color-picker, json-formatter, hash, uuid, timestamp, url...
Dev(37): userscripts, regex, network, jwt, diff, sql, protobuf, dom, api-tester...
Efficiency(13): smooth-scroll, tabs, clipboard, pomodoro, session-manager...
Sec/Media/Browser(19): password-gen, image-tools, reader-mode, translate, bilibili-plus...

## 变更历史

v2.2.0 Global Persistence: `useToolState`原子化存储 | Playwright+SafeStorage | `useClipboardIntent`智能意图

v2.3.0 UserScripts Pro: chrome.userScripts API(MAIN world/document_start) | registry.ts 动态注册 | Smooth Scroll 智能输入检测 | i18n 去中心化

v2.4.0 SaaT: `pluginType:'script'`伪工具 | Dual Discovery(panel.tsx/script.js) | saat-service.ts 管理 | bilibili-plus/chatgpt-wide 首批

v2.4.1 Unified: i18n Flat→Hydrate 架构 | Icon SSOT(Manifest) | System 隔离(Header 入口) | Extension Manager

v2.5.0 Script Store: `src/scripts/`独立目录 | Fork Mode(编辑官方 → 创建副本) | Active Service 绿标

v2.6.0 Resource Monitor: 系统级面板 | 11 种 CPU 机制 | Header⚡ 入口

v2.6.1 Perf: 消除 setInterval→ 事件驱动 | Visibility Pause(totp/timestamp)

v2.6.2 SSOT: manifest.json`background`字段声明 CPU 消耗 | sourceFile/Line/Detail 注解 | TOOL/SYS/SCRIPT 标签

v2.7.0 Hover Zoom Refactor: Single Resolver Type 架构 | 移除硬编码 HD 规则 | 按功能拆分文件夹 | ViewMode/DNR 架构同步

v2.7.1 Smooth Scroll+: 捕获阶段拦截(虚拟滚动兼容) | 视频页跳过方向键 | SidePanel 键盘滚动 | overlay/hidden 容器支持 @2026-01-07

## 核心任务

**System Isolation**: settings/module-store/permissions 标记`system:true` → 仅 Header 入口
**SaaT**: ✅ Registry 支持`pluginType:'script'` | 点击 Toggle 启/停
**Taxonomy SSOT**: 🔥 kernel/registry/taxonomy.ts 统一管理 ID/Icon/排序
**Permission SSOT**: 🔥 Manifest`permissions:[]`→ 构建生成`PERMISSION_USAGE_MAP`

## 路线图

Phase 10-12 (P1): ✅bilibili-plus ✅chatgpt-wide ✅hover-zoom ✅extension-manager | checksum/ssl-check/csp-analyzer/random-gen | translate/page-annotate/download-manager/tab-group
Phase 13-15 (P2): ocr/ai-chat/code-explain | websocket/graphql/media-sniffer

## 技术原则

SSOT: 定义/类型/UI 源于单一事实(Manifest/Registry)
Atomic: 单工具 ≤200 行，独立生命周期
Isolation: 系统/用户插件物理逻辑隔离
Local First: 零上传，数据本地处理

## 待解决问题

**#1 面板工具后台运行**: 计时器/番茄钟等工具切换标签页时停止运行 → 需 Background Timer + Storage 状态同步方案

**#2 Content Script SSOT**: 目前需手动在 `entry/content.ts` 导入新工具，非真正唯一源 → 需构建系统根据 manifest.script 自动生成入口

**#3 ActiveServices 状态追踪**: 需手动在 `ActiveServicesContext` 添加 storage key → 需动态化读取 manifest 配置

## 关联

[开发规则](../../docs/ai-rules.md)

---

## Spectra vs Halo 对比

### 设计差异（保留）

| 维度     | Spectra      | Halo              |
| -------- | ------------ | ----------------- |
| UI 架构  | Popup        | SidePanel (React) |
| 核心依赖 | audio-engine | ui-kit            |
| 功能定位 | 媒体增强     | 开发者工具箱      |

### 🔴 Halo 发布前需补充

`_locales/` | `store-listings/` | `PRIVACY.md` | `README.md` | `assets/`
