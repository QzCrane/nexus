---
type: reference
status: stable
audience: developer
---

# HALO 规划与架构 (v2.5+)

> DNA: SidePanel-only | 零上传 | 原子化 | 本地优先 | 极致性能
>
> 本文档是 HALO 的**唯一**规划/架构 owner。原 [plan.md](./plan.md)、[architecture.md](./architecture.md)、[docs/halo-dev-flow.md](../../docs/halo-dev-flow.md) 三份分散文档已合并入此。

## §1 模块结构

```plaintext
src/
├─ entry/: background, content, sidepanel.tsx
├─ components/
│  ├─ manager/: ToolManager, ToolManagerItem
│  ├─ search/: SearchBar, search-utils
│  ├─ core/: ToolErrorBoundary, lazy-tool-loader, ToolPanelRenderer
│  ├─ legacy/: (deprecated components)
│  ├─ settings/internal/dark-mode/: Internal feature (not a plugin)
│  └─ sidepanel/: Launcher components
├─ kernel/{registry(_generated,taxonomy,module), managers(Perm/Module), services(saat)}
├─ tools/[id]/{manifest.json, panel.tsx} → pluginType:'tool'
├─ scripts/[id]/{manifest.json, script.js} → pluginType:'script'
├─ system/[id]/{manifest.json, panel.tsx} → pluginType:'system'
└─ i18n/{locales/, _generated-tools-*.ts}
```

## §2 工具模块规范

每个工具目录结构:

```text
tools/qrcode/
├── index.ts        # 导出入口 (≤50行)
├── types.ts        # 类型定义
├── core.ts         # 核心逻辑 (≤150行)
└── panel.tsx       # UI 组件 (≤200行)
```

**命名约定**：

- 工具 ID: `qrcode`, `color-picker` (kebab-case)
- 存储键: `HALO_QRCODE_HISTORY` (UPPER_SNAKE)
- 消息类型: `HALO_RULER_START` (UPPER_SNAKE)

## §3 插件架构

pluginType: `tool`(面板) | `script`(SaaT,嵌套) | `system`(设置/商店/权限)
**内部特性**: 沉入 `Settings` 内部组件(如 Dark Mode) | 绝禁直接注册防污染 Registry

分类(SSOT): 虚拟(active,scripts,system) → 功能(general,encode,format,network,data,dev,efficiency,browser,visual,media,security,ai)

排序: active → scripts → system → 功能分类

Registry 产出: `PLUGIN_REGISTRY` | `BACKGROUND_PLUGIN_IDS` | `get{Tool,Script,System}Plugins()`

## §4 SidePanel 规范

入口: `src/entry/sidepanel.tsx`

### 主题系统

```ts
// CSS Variables
(--halo - bg, --halo - bg - secondary, --halo - bg - tertiary);
(--halo - text, --halo - text - secondary, --halo - text - muted);
(--halo - border, --halo - accent, --halo - accent - hover);
(--halo - success, --halo - error);
```

### 入口方式

| 入口     | 触发             | 说明               |
| :------- | :--------------- | :----------------- |
| 图标点击 | action.onClicked | 直接打开 SidePanel |
| 右键菜单 | contextMenus     | 页面/选择/链接     |
| 快捷键   | commands         | 待实现             |

## §5 UI 系统 (Premium)

主题: `theme.ts` 扩展 Premium UI Tokens (`cardBg`, `glassBorder`, `shadow`)
风格: Glassmorphism(毛玻璃) | 动态 CSS Variables 暗黑模式
组件: `Dark Mode` 控制面板内置 Settings (亮度/对比/滤镜/CSS 修复)
安全: 敏感路由 (`chrome://`) 强化拦截与 Toast 不可抗力提示

## §6 规范

行数: ≤150 推荐 | >150 警告 | >200 必拆
模块: `{core.ts, panel.tsx, index.ts(≤50)}`
类型: `PluginMeta`(统一) / `ToolMeta`(别名)

## §7 核心服务

搜索: unified-search.ts(多语言/拼音) | i18n: 去中心化+自动聚合 | 状态: useToolState(原子隔离) | 权限: PermissionManager(声明式) | SaaT: saat-service.ts

## §8 i18n 架构

原则: 工具自治 | SSOT | 扁平源码 | 嵌套运行时

流程: 开发(扁平 Key `tools.qrcode.name`) → 构建(扫描`src/{tools,system}/*/locales`生成`_generated-tools-*.ts`) → 运行(hydrateTranslations 还原嵌套)

目录: `src/tools/[id]/locales/{en,zh}.ts` 独立维护 → `src/i18n/locales/`聚合

格式: 必须扁平 Key(`"tools.my-tool.name": "My Tool"`) | 禁嵌套 tools 对象(防覆盖)

使用: `t('tools.${toolId}.name')` | `t('myTool.action.save')`

优势: 解决合并冲突 | 兼容 i18next 标准查找

## §9 动画系统 (v2.5.0)

位置: `src/components/ui/animated-transition/` | `public/sidepanel.html`(keyframes)

组件: `SimpleTransition`(CSS 过渡) | `AnimatedTransition`(状态驱动,复杂场景)

全局 Keyframes: `slideInFromRight` | `slideInFromLeft` | `fadeInUp`

配置: `enableAnimations`(开关) | `animationSpeed`(fast/normal/slow)
执行链路: Home↔Tool(0.3s `translateX`) | 子页面(0.28s `slideInFromRight`) | Tab切换(禁动画防卡顿)

## §10 工具库 (v2.6)

> 定位: 离线优先开发者/效率工具箱 | 对标: DevToys, IT-Tools, He3
> 状态: 84 User + 3 System Tools | SidePanel | Local First

System(3): settings, module-store, permissions
Core(10): qrcode, color-picker, json-formatter, hash, uuid, timestamp, url...
Dev(37): userscripts, regex, network, jwt, diff, sql, protobuf, dom, api-tester...
Efficiency(13): smooth-scroll, tabs, clipboard, pomodoro, session-manager...
Sec/Media/Browser(19): password-gen, image-tools, reader-mode, translate, bilibili-plus...

## §11 变更历史

v2.2.0 Global Persistence: `useToolState`原子化存储 | Playwright+SafeStorage | `useClipboardIntent`智能意图

v2.3.0 UserScripts Pro: chrome.userScripts API(MAIN world/document_start) | registry.ts 动态注册 | Smooth Scroll 智能输入检测 | i18n 去中心化

v2.4.0 SaaT: `pluginType:'script'`伪工具 | Dual Discovery(panel.tsx/script.js) | saat-service.ts 管理 | bilibili-plus/chatgpt-wide 首批

v2.4.1 Unified: i18n Flat→Hydrate 架构 | Icon SSOT(Manifest) | System 隔离(Header 入口) | Extension Manager

v2.5.0 Script Store: `src/scripts/`独立目录 | Fork Mode(编辑官方 → 创建副本) | Active Service 绿标
v2.5.1 LLM Suite: `chatgpt-wide` → `llm-enhancer` | Support ChatGPT/DeepSeek/Gemini | Timeline/Widescreen/KeepAlive @2026-02-01
v2.5.2 Bilibili+: Playback Speed | Esc Fix | Clean Home | Viewer Count (Planned) @2026-02-01
v2.5.3 LLM Enhancer V3: Glassmorphism UX | Floating Dock | Keyboard shortcuts | Auto Scroll Highlight @2026-02-02
v2.5.4 LLM Enhancer Fix: TypeScript Refactor | Event-Driven State Sync | CSS Visibility Control | Gemini Navigation Fix @2026-02-03

v2.6.0 Resource Monitor: 系统级面板 | 11 种 CPU 机制 | Header 入口

v2.6.1 Perf: 消除 setInterval→ 事件驱动 | Visibility Pause(totp/timestamp)

v2.6.2 SSOT: manifest.json `background` 字段声明 CPU 消耗 | sourceFile/Line/Detail 注解 | TOOL/SYS/SCRIPT 标签

v2.7.0 Hover Zoom Refactor: Single Resolver Type 架构 | 移除硬编码 HD 规则 | 按功能拆分文件夹 | ViewMode/DNR 架构同步

v2.7.1 Smooth Scroll+: 捕获阶段拦截(虚拟滚动兼容) | 视频页跳过方向键 | SidePanel 键盘滚动 | overlay/hidden 容器支持 @2026-01-07

v2.7.2 Hover Zoom Fix: B 站图片原图解析(参考 PhotoShow) | RuleEngine 子域名匹配 | fetch blob 获取跨域文件大小 | 精度 2 位小数 @2026-01-08

v2.8.0 Extreme Perf: Smooth Scroll (Hot Cache/Zero-Alloc) | Ruler (rAF Lock) | Hover Zoom (Zero-Alloc Debounce) | DomHelpers (Linear Scan) @2026-02-01

## §12 核心任务 (EPR 映射)

| EPR | 任务 | 状态 |
|---|---|---|
| EPR-001 SSOT | System Isolation: settings/module-store/permissions 标记 `system:true` → 仅 Header 入口 | 完成 |
| EPR-007 Capability | SaaT: Registry 支持 `pluginType:'script'` \| 点击 Toggle 启/停 | 完成 |
| EPR-001 SSOT | Taxonomy SSOT: kernel/registry/taxonomy.ts 统一管理 ID/Icon/排序 | 进行中 |
| EPR-021 Boundary | Permission SSOT: Manifest `permissions:[]` → 构建生成 `PERMISSION_USAGE_MAP` | 进行中 |

## §13 路线图

Phase 10-12 (P1): 完成 bilibili-plus, llm-enhancer, hover-zoom, extension-manager | checksum/ssl-check/csp-analyzer/random-gen | translate/page-annotate/download-manager/tab-group
Phase 13-15 (P2): ocr/ai-chat/code-explain | websocket/graphql/media-sniffer

## §14 技术原则

- **SSOT**: 定义/类型/UI 源于单一事实(Manifest/Registry)
- **Atomic**: 单工具 ≤200 行,独立生命周期
- **Isolation**: 系统/用户插件物理逻辑隔离
- **Local First**: 零上传,数据本地处理

## §15 待解决问题

**#1 面板工具后台运行**: 计时器/番茄钟等工具切换标签页时停止运行 → 需 Background Timer + Storage 状态同步方案

**#2 Content Script SSOT**: 目前需手动在 `entry/content.ts` 导入新工具,非真正唯一源 → 需构建系统根据 manifest.script 自动生成入口

**#3 ActiveServices 状态追踪**: 需手动在 `ActiveServicesContext` 添加 storage key → 需动态化读取 manifest 配置

## §16 Spectra vs Halo 对比

### 设计差异（保留）

| 维度     | Spectra      | Halo              |
| -------- | ------------ | ----------------- |
| UI 架构  | Popup        | SidePanel (React) |
| 核心依赖 | audio-engine | ui-kit            |
| 功能定位 | 媒体增强     | 开发者工具箱      |

### Halo 发布前需补充

`_locales/` | `store-listings/` | `PRIVACY.md` | `README.md` | `assets/`
