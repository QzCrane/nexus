# Halo i18n Architecture

> **核心原则**: 工具自治 (Tool Autonomy)、单一数据源 (SSOT)、扁平开发 (Flat Source)、嵌套运行 (Nested Runtime)。

## 1. 概览 (Overview)

Halo 的国际化 (i18n) 系统旨在解决模块化开发中的一大痛点：翻译文件的分散与聚合。
我们采用了一种创新的 **"Flat Source, Nested Runtime"** 架构：

- **开发时**：每个工具在自己的目录下维护独立的 locale 文件，推荐使用**扁平 Key**（如 `'tools.qrcode.name'`）以避免深度合并冲突。
- **构建时**：脚本自动扫描所有工具目录，生成聚合入口文件 (`_generated-tools-*.ts`)。
- **运行时**：i18n 核心模块使用 `hydrateTranslations` 工具将所有扁平 Key 自动还原为深层嵌套对象，以便与 `i18next` 的标准查找逻辑完美兼容。

## 2. 目录结构 (Directory Structure)

每个工具（无论是 `src/tools` 还是 `src/system`）都必须包含一个 `locales` 目录：

```text
src/
├── tools/
│   └── qrcode/
│       ├── index.ts
│       └── locales/           <-- 翻译源文件
│           ├── en.ts          <-- 英文定义
│           └── zh.ts          <-- 中文定义
├── system/
│   └── settings/
│       └── locales/           <-- 系统模块同理
└── i18n/
    ├── locales/
    │   ├── en.ts              <-- 聚合入口 (Runtime)
    │   └── _generated-tools-en.ts <-- 自动生成 (不要手动修改)
    └── utils.ts               <-- Hydration 逻辑
```

## 3. 开发规范 (Development Standards)

### 3.1 翻译文件格式

在 `locales/{lang}.ts` 中，**必须**使用扁平 Key 格式来定义工具名称和描述。这确保了多个工具合并时不会发生对象覆盖。

**推荐格式 (Flat Keys):**

```typescript
// src/tools/my-tool/locales/en.ts
export const en = {
  // 必须：工具标准元数据
  "tools.my-tool.name": "My Tool",
  "tools.my-tool.desc": "Description of my tool",

  // 可选：工具内部专属翻译 (可以使用扁平 Key 或独立 Namespace 对象)
  "myTool.action.save": "Save Item",
  "myTool.error.notFound": "Item not found",

  // 或者使用独立 Namespace 对象 (只要不与 'tools' 对象冲突即可)
  myToolPanel: {
    title: "My Panel",
  },
};
```

### 3.2 使用翻译

在 React 组件中正常使用 `t()` 函数。得益于 Runtime Hydration，你可以像访问对象属性一样访问这些 Key。

```tsx
// 组件中
const { t } = useTranslation();

// 访问工具名称 (标准)
<h1>{t(`tools.${toolId}.name`)}</h1>

// 访问工具内部文本
<button>{t('myTool.action.save')}</button>
<button>{t('myToolPanel.title')}</button>
```

## 4. 核心机制 (Core Mechanics)

### 4.1 自动聚合 (Aggregation)

构建脚本 `scripts/generate-tool-registry.mjs` 会扫描 `src/tools` 和 `src/system` 下的所有文件夹。
如果发现 `locales/{lang}.ts`，它会生成 import 语句并将其添加到 `_generated-tools-{lang}.ts` 的导出对象中。

### 4.2 运行时还原 (Runtime Hydration)

由于 `i18next` 默认不支持混合结构（即同时存在 `tools` 对象和 `'tools.x.x'` 字符串 Key 导致的查找路径截断），我们在 `src/i18n/locales/{en,zh}.ts` 中引入了 **Hydration** 步骤。

```typescript
// src/i18n/utils.ts
export const hydrateTranslations = (source) => {
  // 将 {'a.b.c': 'val'} 转换为 {a: {b: {c: 'val'}}}
  // 自动处理合并冲突
};
```

```typescript
// src/i18n/locales/en.ts
export const en = {
  ...base,
  ...hydrateTranslations(TOOLS_EN), // <--- 关键步骤
};
```

## 5. 迁移历史 (Migration History)

- **Legacy**: 早期版本使用 centralized `modules.ts`，导致严重的合并冲突和维护困难。
- **Evolution**: 引入了 `generate-tool-registry` 但最初遇到了 Key 查找冲突。
- **Current**: 完全废弃 `modules.ts`，采用全分布式架构 + Runtime Hydration，彻底解决了扩展性和冲突问题。
