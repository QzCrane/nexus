# HALO 架构 (v1.7.0)

> DNA: SidePanel-only | 零上传 | 原子化模块 (tools/)

## 📂 结构

- entry/: background(RPC), content(DOM), sidepanel.tsx(Entry)
- components/: UI + \_generated-tool-loader.ts(Mapping) + sidepanel/(Context)
- kernel/: core/, registry/(\_generated.ts), managers/, hooks/, utils/
- tools/: [tool-name]/{manifest.json, panel.tsx, core.ts, .ai-context.md}
- i18n/: locales/ (zh.ts, en.ts) + i18n-core.ts(初始化)

## ⚙️ 自动化注册

tools/\*/manifest.json (83+) → pnpm generate-registry → \_generated.ts & loader.ts
新增: 创建 manifest + panel → pnpm build 自动注册

## 📏 规范

- 行数: 推荐 ≤150 | 警告 >150 | 红线 >200 (必须拆分)
- 模块: core.ts(逻辑) / panel.tsx(UI) / index.ts(出口 ≤50)
- UI: @nexus/ui-kit + CSS Vars | 4px 网格 | 禁用引起 Layout Shift 的动态 Padding

## 🚀 核心服务

- 搜索: **unified-search.ts** - 全语言/拼音(全拼+简拼)/多字段/自动扩展新语言
- i18n: Global Signal + Listener 同步，模块化(i18n-core.ts + index.ts)
- 状态: **useToolState** (防抖持久化/sync 或 local 可选/跨窗口同步)
- 性能: EngineStatusProvider | Zero-Copy Data | detachNode(资源销毁)
- 可靠性: ToolErrorBoundary(故障隔离) | safe-storage(5s 超时/sync+local) | ModuleManager 内存降级

## 🔌 通信

RPC: `chrome.runtime.sendMessage` | Type-Safe `ToolId` (Registry Derived + SystemToolId)

## 🎨 UI 规范

- 组件: 必须优先使用 `@nexus/ui-kit` (Card, Button, Toggle)
- 布局: 4px 网格 | 禁用 Layout Shift | 强制响应式

## 🔍 搜索系统 (v1.6.0)

- 引擎: `kernel/utils/unified-search.ts`
- 特性: 自动注册新语言 | Pinyin 全拼+简拼 | 标题+描述全匹配
- 扩展: `registerSearchLocale(locale, data)` 注册新语言即可搜索

## 📦 类型统一 (v1.7.0)

- **ToolMeta**: 统一工具/模块元数据，消除 ModuleMeta 冗余
- 模块字段 (size/builtIn/dependencies) 作为可选字段集成到 ToolMeta
- `ModuleMeta` 保留为 `ToolMeta` 别名，向后兼容

## 🧩 状态管理 (v1.7.0)

- **SidePanelContext**: 集中管理 SidePanel 状态，消除 prop drilling
- `useSidePanel()`: 获取全部状态和 actions
- `useActiveTool()`: 仅获取当前工具 (最小化重渲染)
- `useToolActions()`: 仅获取工具操作函数

## ⚡ 性能优化 (v1.7.0)

- **i18n Promise**: `waitForI18n()` 支持 async/await，可配合 Suspense
- **Idle Preload**: `useIdlePreload(toolIds, 5)` 空闲时批量预加载常用工具
- **Staggered Loading**: 预加载间隔 50ms，避免阻塞主线程
