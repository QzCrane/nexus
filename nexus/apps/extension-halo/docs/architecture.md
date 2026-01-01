# HALO 架构规范 v1.4.0

> 目录结构/集成策略/代码规范

## §1 目录结构

```
src/
├── entry/                      # Chrome 扩展入口
│   ├── background.ts           # Service Worker (RPC 路由)
│   ├── content.ts              # Content Script (DOM 操作)
│   ├── sidepanel.tsx           # SidePanel 主入口 (React)
│   └── sidepanel-init.ts       # 初始化 (CSP/主题预加载)
│
├── components/                 # 公共 UI 组件
│   ├── sidepanel/              # 布局系统 (Classic/Launcher)
│   ├── lazy-tool-loader.tsx    # 懒加载渲染器
│   └── _generated-tool-loader.ts # [自动生成] Panel 映射
│
├── kernel/                     # 核心基础设施
│   ├── core/                   # types, storage, theme, settings
│   ├── registry/               # 工具注册表
│   │   ├── _generated.ts       # [自动生成] 工具元数据
│   │   ├── module-registry.ts  # 模块管理 (消费生成数据)
│   │   └── tool-registry.ts    # 工具查询 API
│   ├── managers/               # 模块管理器
│   └── hooks/                  # React Hooks
│
├── tools/                      # 工具模块 (原子化)
│   └── [tool-name]/
│       ├── manifest.json       # [必须] 工具元数据 (icon/category/size)
│       ├── panel.tsx           # [必须] React UI 组件
│       ├── core.ts             # 纯业务逻辑 (无 UI)
│       └── .ai-context.md      # 模块 AI 上下文
│
└── i18n/                       # 国际化 (en.ts, zh.ts)
```

---

## §2 工具注册系统

### 自动生成流程

```
tools/*/manifest.json (82个)
        ↓
pnpm generate-registry (或 pnpm build 自动执行)
        ↓
kernel/registry/_generated.ts  → 工具元数据
components/_generated-tool-loader.ts → lazy import 映射
```

### 新增工具步骤

1. 创建 `tools/[name]/manifest.json`:

```json
{
  "id": "tool-name",
  "icon": "🔧",
  "category": "dev",
  "size": 15000,
  "builtIn": false,
  "keywords": []
}
```

2. 创建 `tools/[name]/panel.tsx`:

```tsx
export const ToolNamePanel: React.FC = () => { ... }
```

3. 运行 `pnpm build` (自动执行 generate-registry)

### manifest.json 字段

| 字段     | 类型     | 必须 | 说明                                                       |
| :------- | :------- | :--: | :--------------------------------------------------------- |
| id       | string   |  ✓   | 唯一 ID (kebab-case, 与目录名一致)                         |
| icon     | string   |  ✓   | 显示图标 (emoji)                                           |
| category | string   |  ✓   | 分类: general/dev/efficiency/security/media/browser/visual |
| size     | number   |  ✓   | 估算体积 (bytes)                                           |
| builtIn  | boolean  |      | 核心模块 (不可卸载)                                        |
| keywords | string[] |      | 搜索关键词                                                 |

---

## §3 代码规范

### 行数限制

|    阈值 | 处理              |
| ------: | :---------------- |
|    ≤150 | ✅ 正常           |
| 150-200 | ⚠️ 警告，建议拆分 |
|    >200 | ❌ 错误，必须拆分 |

### 豁免文件

- `_generated.ts` / `_generated-tool-loader.ts` (自动生成)
- `i18n/locales/**/modules.ts` (数据文件)

### 模块化原则

- `core.ts`: 纯逻辑，无 UI，便于测试
- `panel.tsx`: 只负责渲染和交互
- `index.ts`: 模块唯一出口 (≤50 行)

---

## §4 UI 设计

遵循 `@nexus/ui-kit` + CSS Variables

- 颜色: `--halo-bg`, `--halo-accent`, `--halo-text`
- 间距: 4px 网格 (4/8/12/16/24)
- 字体: 系统字体栈，代码用 monospace

---

## §5 通信协议

RPC 模式: `chrome.runtime.sendMessage`

- Action 命名: `HALO_ACTION_NAME` (全大写下划线)
- 消息格式: `{ source: 'HALO', action: '...', data: ... }`
