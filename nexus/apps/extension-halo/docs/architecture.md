# HALO 架构 (v2.3.0)

> DNA: SidePanel-only | 零上传 | 原子化模块 (tools/) | 本地优先 | 极致性能

## 📂 结构 (v2.3.0 Update)

- entry/: background(RPC), content(DOM), sidepanel.tsx(Entry)
- components/: UI + \_generated-tool-loader.ts(Unified Loader) + sidepanel/(Context)
- kernel/:
  - registry/(\_generated.ts, taxonomy.ts)
  - managers/(Permission/Module)
  - core/
- tools/: [tool-name]/{manifest.json, panel.tsx, core.ts, locales/} 👈 **User Tools**
- system/: [component]/{manifest.json, panel.tsx, locales/} 👈 **System Components**
- i18n/: locales/ (zh.ts, en.ts) + i18n-core.ts(初始化/Loader)

## ⚙️ 双路注册体系 (Dual Registry System)

我们采用物理文件隔离架构，构建脚本 `generate-tool-registry.mjs` 执行双路扫描：

1.  **User Tools (`src/tools/*`)** -> `USER_TOOL_REGISTRY`
    - 纯净业务工具，严格禁止 System 权限
2.  **System Plugins (`src/system/*`)** -> `SYSTEM_PLUGIN_REGISTRY`
    - 系统级页面 (Settings, Store, Permissions)，标记 `system: true`

产出物 `_generated.ts` 包含 SSOT (Single Source of Truth) 数据：

- `ALL_APPS`: 路由组件使用的全集
- `PERMISSION_USAGE_MAP`: 权限反向依赖图

## 📏 规范

- 行数: 推荐 ≤150 | 警告 >150 | 红线 >200 (必须拆分)
- 模块: core.ts(逻辑) / panel.tsx(UI) / index.ts(出口 ≤50)
- UI: @nexus/ui-kit + CSS Vars | 4px 网格 | 禁用引起 Layout Shift 的动态 Padding

## 🚀 核心服务 (Core Services)

- **搜索 (Search)**: `unified-search.ts` - 全语言/拼音/多字段/自动扩展
- **国际化 (i18n)**: 去中心化 (tools/_/locales) + System (system/_/locales) + 自动化聚合
- **状态 (State)**: `useToolState` - 自动序列化/防抖/原子化隔离 (`halo_tool_state_${id}`)
- **权限 (Permissions)**: `PermissionManager` - 基于 Manifest 的声明式权限管理 (SSOT)
- **性能 (Perf)**: EngineStatusProvider | Zero-Copy Data | detachNode

## 🔌 通信

RPC: `chrome.runtime.sendMessage` | Type-Safe `ToolId` (Registry Derived)

## 🎨 UI 规范

- 组件: 必须优先使用 `@nexus/ui-kit`
- 布局: 4px 网格 | 禁用 Layout Shift | 强制响应式
- 图标: Manifest 为唯一数据源 (SSOT) | 禁硬编码

## 🧩 系统演进

### v1.8.0 系统服务化

- **Permissions Service**: `PermissionManager`
- **Decentralized i18n**: 工具自包含翻译文件

### v2.0.0 质量工程

- **UI Automation**: Playwright + 截图
- **Safe Storage**:防止慢速 I/O 挂起

### v2.2.0 全局持久化

- **Atomic State**: 基于 ToolId 的原子化存储隔离
- **Smart Intent**: 智能剪贴板意图

### v2.3.0 架构统一与隔离 (current)

- **Physical Isolation**: `src/tools` 与 `src/system` 物理分离
- **SSOT**:
  - Taxonomy (`taxonomy.ts`)
  - Permissions (Manifest -> Registry Map)
  - Registry (Dual Scan)
  - Icons (Manifest -> Registry -> UI Components)
