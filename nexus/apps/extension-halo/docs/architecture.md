# HALO 架构 (v2.2.0)

> DNA: SidePanel-only | 零上传 | 原子化模块 (tools/) | 本地优先 | 极致性能

## 📂 结构

- entry/: background(RPC), content(DOM), sidepanel.tsx(Entry)
- components/: UI + \_generated-tool-loader.ts(Mapping) + sidepanel/(Context)
- kernel/: core/, registry/(\_generated.ts), managers/(Permission/Module), hooks/, utils/
- tools/: [tool-name]/{manifest.json, panel.tsx, core.ts, .ai-context.md, locales/}
- i18n/: locales/ (zh.ts, en.ts) + i18n-core.ts(初始化/Loader)

## ⚙️ 自动化注册

tools/\*/manifest.json (83+) → pnpm generate-registry → \_generated.ts & loader.ts & i18n
新增: 创建 manifest + panel + locales → pnpm build 自动注册

## 📏 规范

- 行数: 推荐 ≤150 | 警告 >150 | 红线 >200 (必须拆分)
- 模块: core.ts(逻辑) / panel.tsx(UI) / index.ts(出口 ≤50)
- UI: @nexus/ui-kit + CSS Vars | 4px 网格 | 禁用引起 Layout Shift 的动态 Padding

## 🚀 核心服务 (Core Services)

- **搜索 (Search)**: `unified-search.ts` - 全语言/拼音(全拼+简拼)/多字段/自动扩展
- **国际化 (i18n)**: 去中心化 (tools/\*/locales) + `waitForI18n()` 异步加载 + 实时切换
- **状态 (State)**: `useToolState` - 自动序列化/防抖/原子化隔离 (`halo_tool_state_${id}`)
- **权限 (Permissions)**: `PermissionManager` - 内核级权限与事件总线管理
- **性能 (Perf)**: EngineStatusProvider | Zero-Copy Data (WebAudio) | detachNode (生命周期清理)
- **可靠性 (Reliability)**: safe-storage (5s 超时/sync+local) | ModuleManager 内存降级

## 🔌 通信

RPC: `chrome.runtime.sendMessage` | Type-Safe `ToolId` (Registry Derived + SystemToolId)

## 🎨 UI 规范

- 组件: 必须优先使用 `@nexus/ui-kit` (Card, Button, Toggle)
- 布局: 4px 网格 | 禁用 Layout Shift | 强制响应式 | 零交互完成设计

## 🧩 系统演进

### v1.8.0 系统服务化

- **Permissions Service**: `PermissionManager` + `pages/permissions` + `usePermission`
- **Decentralized i18n**: 工具自包含翻译文件，构建时聚合

### v2.0.0 质量工程

- **UI Automation**: Playwright (`test/ui-playwright.spec.ts`) + 截图
- **Safe Storage**:防止慢速 I/O 挂起 App 初始化

### v2.2.0 全局持久化

- **Atomic State**: 基于 ToolId 的原子化存储隔离，增删插件无副作用
- **Smart Intent**: `useClipboardIntent` 智能识别剪贴板内容类型
- **Sync Engine**: `halo_tool_state` 支持跨窗口与 Storage 自动同步
