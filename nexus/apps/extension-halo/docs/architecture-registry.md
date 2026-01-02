# Halo 统一架构标准：注册表、SSOT 与隔离策略 (v2.3.0)

本文档是 Halo v2.3.0 的核心架构规范，确立了 **单一事实来源 (SSOT)** 与 **系统级隔离** 的最高准则。

## 1. 核心原则 (Core Principles)

1.  **SSOT (Single Source of Truth)**: 所有的定义（类型、UI、逻辑、权限）必须有且仅有一个源头，禁止多处硬编码。
2.  **Strict Isolation (严格隔离)**: 系统插件（Settings/Store/Permissions）与用户工具必须在**构建阶段**物理分离，严禁混入用户工具列表。
3.  **Inversion of Control (控制反转)**: 内核不持有插件信息，一切由插件的 `manifest.json` 声明。

---

## 2. 双注册表体系 (Dual Registry System)

为彻底解决“系统插件污染工具列表”的问题，构建系统将根据 `system` 字段生成两个独立的运行时注册表。

### 2.1 源头：Manifest 声明

```json
// tools/settings/manifest.json
{
  "id": "settings",
  "system": true,  // 👈 系统插件标识
  "icon": "⚙️",
  ...
}
```

### 2.2 构建产物：物理分离 (`_generated.ts`)

构建脚本 `generate-tool-registry.mjs` 将不再输出单一数组，而是分裂为两个常量：

```typescript
// 1. 用户工具注册表 (供 Launcher/Search 消费)
export const USER_TOOL_REGISTRY: ToolMeta[] = [
  { id: 'qrcode', system: false, ... },
  { id: 'json-formatter', system: false, ... }
];

// 2. 系统插件注册表 (供 Router/Global UI 消费)
export const SYSTEM_PLUGIN_REGISTRY: ToolMeta[] = [
  { id: 'settings', system: true, ... },
  { id: 'module-store', system: true, ... },
  { id: 'permissions', system: true, ... }
];

// 聚合类型 (仅用于 ID 校验)
export type AnyToolId = UserToolId | SystemPluginId;
```

### 2.3 消费端行为

- **工具列表 (Tool List)**: 仅迭代 `USER_TOOL_REGISTRY`。
- **全局搜索 (OmniSearch)**: 默认搜索 `USER`，仅当输入特定指令或在系统上下文中才检索 `SYSTEM`。
- **路由 (Router)**: 同时接受两者，确保系统页面可被渲染。

---

## 3. SSOT 实施标准 (Single Source of Truth)

所有子系统必须遵循 SSOT 原则，禁止逻辑碎片化。

### 3.1 分类 (Taxonomy SSOT)

**现状**: 散落在 `types.ts` 和 `ToolManager.tsx`。
**标准**: 统一至 `kernel/registry/taxonomy.ts`。

```typescript
// Source
export const TAXONOMY_DEFINITIONS = [
  { id: 'dev', icon: '🛠️', order: 10, label: 'Development' },
  ...
] as const;

// Derived Type
export type ToolCategory = typeof TAXONOMY_DEFINITIONS[number]['id'];

// Derived UI
// UI 组件直接 .map(TAXONOMY_DEFINITIONS) 渲染，禁止硬编码排序。
```

### 3.2 权限 (Permission SSOT)

**现状**: 内核硬编码 `requiredBy`。
**标准**: 依赖回归 Manifest，构建生成反向索引。

- **Source**: `tools/*/manifest.json` -> `permissions: []`
- **Computed**: `_generated.ts` -> `PERMISSION_USAGE_MAP`
- **Consumer**: `PermissionManager` (只读 Map，无硬编码)

### 3.3 国际化 (I18n SSOT)

**标准**: 分布式源，集中式构建。

- **Source**: `tools/*/locales/*.ts` (Co-location)
- **Computed**: `i18n/locales/_generated-tools-*.ts`
- **Consumer**: `i18n-core` (自动加载)

---

## 4. 能力映射 (Capability Mapping)

通过 `manifest.features` 显式声明内核能力要求，消除隐式依赖。

| Feature Flag    | 含义     | 内核行为                         |
| :-------------- | :------- | :------------------------------- |
| `contextMenu`   | 右键菜单 | 构建时注册 ContextMenus          |
| `contentScript` | 页面注入 | 运行时通过 `ScriptInjector` 注入 |
| `offscreen`     | 后台计算 | 初始化 Offscreen Document 通信桥 |

---

## 5. 迁移检查清单 (Migration Checklist)

为达成 v2.3.0 架构目标，需执行以下重构：

- [ ] **Manifest Schema**: 强制校验 `system`, `permissions`, `features` 字段。
- [ ] **Registry Split**: 重写 `generate-tool-registry.mjs`，拆分输出 `USER_TOOL_REGISTRY` 和 `SYSTEM_PLUGIN_REGISTRY`。
- [ ] **Taxonomy**: 创建 `taxonomy.ts` 并替换所有硬编码分类引用。
- [ ] **Permissions**: 迁移所有内核权限定义到各工具的 manifest 中。
- [ ] **UI Clean**: 确保 `ToolManager` 和 `Launcher` 仅引用 `USER_TOOL_REGISTRY`。

该架构确保了系统的纯净性：**系统插件隐形化，用户工具原子化，所有定义单一化。**
