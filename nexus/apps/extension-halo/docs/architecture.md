# NEXUS 架构规范 (Architecture Spec)

> 本文档定义了项目的目录结构、集成策略和代码规范。

## §1 系统架构目录

```text
src/
├── entry/              # Chrome 扩展入口
│   ├── background.ts   # Service Worker (RPC 路由中心)
│   ├── content.ts      # Content Script (DOM 操作/滚动/覆盖层)
│   ├── sidepanel.tsx   # SidePanel 主界面入口 (React)
│   └── sidepanel-init.ts # 初始化脚本 (处理 CSP 和主题预加载)
│
├── kernel/             # 核心基础设施 (与具体业务解耦)
│   ├── types.ts        # 全局类型 (ToolId, 消息定义)
│   ├── storage.ts      # 存储封装 (类型安全, Promise化)
│   ├── settings.ts     # 默认配置与常量
│   ├── theme.ts        # 主题系统 (管理 CSS 变量)
│   └── logger.ts       # 日志工具
│
├── tools/              # 工具模块 (原子化, 独立目录)
│   ├── [tool-name]/    # 例如: qrcode, regex
│   │   ├── index.ts    # 模块出口 (只导出 Panel 和必要的 Core)
│   │   ├── types.ts    # 模块私有类型
│   │   ├── core.ts     # 纯业务逻辑 (无 UI, 便于测试)
│   │   ├── panel.tsx   # React UI 组件
│   │   └── .ai-context.md # 模块专属 AI 上下文
│   └── ...
│
└── i18n/               # 国际化系统
    ├── locales/        # 语言包 (en.ts, zh.ts)
    └── index.ts        # Hook 封装
```

---

## §2 集成策略

### 1. 核心工具 (Bundled)

此类工具直接打包进扩展，随 SidePanel 立即加载。

- **准入条件**: 高频使用 + 体积小 (每个 < 50KB)
- **加载方式**: 静态导入 (Static Import)
- **当前列表**:
  - 基础: QR, Color, Ruler, JSON, Outline, Settings
  - 开发: Regex, Base64, Hash, UUID, Time, URL
  - 效率: Clipboard, Smooth Scroll

### 2. 大型模块 (Lazy Loaded)

此类工具在用户通过 UI 激活时才加载，避免拖慢启动速度。

- **准入条件**: 低频使用 或 体积巨大 (> 1MB，通常涉及 WASM)
- **加载方式**: 动态导入 (`import()`) + 资源按需获取
- **规划列表**:
  - `pdf` (依赖 pdf-lib, ghostscript)
  - `ai` (依赖 onnx runtime)
  - `archive` (依赖 singlefile core)

---

## §3 代码规范

### 模块化原则

- **单一职责**: `core.ts` 只负责数据处理和计算，`panel.tsx` 只负责渲染和交互。
- **解耦**: 工具之间尽量不互相依赖。如果必须通信，通过 `kernel` 的消息总线进行。
- **接口控制**: `index.ts` 是模块的唯一对外接口，不要直接引用模块内部文件。

### 开发限制

- **文件行数**: 单个文件建议控制在 200 行以内，绝对禁止超过 500 行（必须拆分）。
- **硬编码**: 禁止在代码中硬编码 URL、复杂规则表，应提取到常数文件或配置中。
- **注释**: 核心逻辑必须编写**中文注释** (根据用户最新偏好)，解释"为什么这么做"而不仅仅是"做了什么"。

---

## §4 UI 设计系统

必须严格遵循 `@nexus/ui-kit` 和 CSS 变量系统，保持视觉统一。

- **颜色变量**: `--halo-bg` (背景), `--halo-accent` (强调色), `--halo-text` (文本)
- **间距**: 使用 4px 网格系统 (4, 8, 12, 16, 24)
- **字体**: 使用系统字体栈，代码部分使用等宽字体 (monospace)

---

## §5 通信协议

扩展内部通信统一使用 `chrome.runtime.sendMessage` 实现 RPC 模式。

- **Action 命名**: `HALO_ACTION_NAME` (全大写下划线)
- **消息格式**: `{ source: 'HALO', action: '...', data: ... }`
