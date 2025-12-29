# HALO 开发流程

## §0 架构

```text
src/
├── entry/              # Chrome 入口
│   ├── background.ts   # Service Worker + 右键菜单
│   ├── content.ts      # Content Script (尺子/大纲跳转)
│   └── sidepanel.tsx   # Main SidePanel UI
│
├── kernel/             # 核心基础设施
│   ├── types.ts        # ToolId, 消息类型
│   ├── storage.ts      # chrome.storage wrapper
│   ├── settings.ts     # 设置类型 + 常量
│   ├── theme.ts        # 主题系统 (CSS Variables)
│   └── index.ts        # re-exports
│
├── tools/              # 独立工具模块 (直接集成)
│   ├── qrcode/         # ✅ 二维码生成/识别
│   ├── color-picker/   # ✅ 颜色拾取
│   ├── ruler/          # ✅ 屏幕尺子
│   ├── json-formatter/ # ✅ JSON 格式化
│   ├── outline/        # ✅ 页面大纲
│   ├── settings/       # ✅ 设置面板
│   ├── clipboard/      # 🔜 智能剪贴板
│   ├── screenshot/     # 🔜 截图批注
│   └── tabs/           # 🔜 标签管理
│
├── modules/            # 可选/大型模块 (按需下载)
│   ├── pdf/            # 🔜 PDF 工具箱 (WASM)
│   ├── archive/        # 🔜 网页存档 (SingleFile)
│   ├── ai/             # 🔜 本地 AI (ONNX)
│   └── dark-mode/      # ⏸️ 搁置
│
└── assets/             # 静态资源
```

---

## §1 集成策略

### 直接打包 (tools/)

体积小(<50KB) + 高频使用 → 随扩展安装

| 工具           | 状态 | 体积  | 依赖   |
| :------------- | :--: | :---: | :----- |
| qrcode         |  ✅  | ~20KB | qrcode |
| color-picker   |  ✅  | ~8KB  | 无     |
| ruler          |  ✅  | ~5KB  | 无     |
| json-formatter |  ✅  | ~6KB  | 无     |
| outline        |  ✅  | ~8KB  | 无     |
| settings       |  ✅  | ~10KB | 无     |
| clipboard      |  🔜  | ~8KB  | 无     |

### 按需下载 (modules/)

体积大(>1MB) / 可选功能 → 首次使用时下载

| 模块    | 预估体积 | 触发条件          |
| :------ | :------: | :---------------- |
| pdf     |  5-15MB  | 用户点击 PDF 工具 |
| archive |  2-5MB   | 用户点击存档按钮  |
| ai      | 10-50MB  | 用户启用 AI 功能  |

---

## §2 开发进度

### Phase 1: 基础架构 ✅

1. SidePanel 框架 + 消息总线
2. kernel/storage + settings + theme
3. 创建 tools/ 目录结构

### Phase 2: 核心工具 ✅

| 优先级 | 工具           | 状态 |
| :----: | :------------- | :--: |
|  P1.1  | qrcode         |  ✅  |
|  P1.2  | color-picker   |  ✅  |
|  P1.3  | json-formatter |  ✅  |
|  P1.4  | ruler          |  ✅  |
|  P1.5  | outline        |  ✅  |
|  P1.6  | settings       |  ✅  |

### Phase 3: 效率工具 🔜

| 优先级 | 工具       | 状态 |
| :----: | :--------- | :--: |
|  P2.1  | clipboard  |  🔜  |
|  P2.2  | screenshot |  🔜  |
|  P2.3  | tabs       |  🔜  |

### Phase 4: 蓝海模块 🔜

| 优先级 | 模块       | 状态 |
| :----: | :--------- | :--: |
|  P0.1  | pdf (基础) |  🔜  |
|  P0.2  | archive    |  🔜  |

---

## §3 工具模块规范

每个工具目录结构:

```text
tools/qrcode/
├── index.ts        # 导出入口 (≤50行)
├── types.ts        # 类型定义
├── core.ts         # 核心逻辑 (≤150行)
└── panel.tsx       # UI 组件 (≤200行)
```

### 命名约定

- 工具 ID: `qrcode`, `color-picker` (kebab-case)
- 存储键: `HALO_QRCODE_HISTORY` (UPPER_SNAKE)
- 消息类型: `HALO_RULER_START` (UPPER_SNAKE)

---

## §4 SidePanel 规范

入口: `src/entry/sidepanel.tsx`

### 布局

```text
┌─────────────────────────────────┐
│ 🌟 HALO                     ⚙️ │  <- Header + Settings
├─────────────────────────────────┤
│ [🔲] [🎨] [📐] [{}] [📋] [📎]  │  <- Tool Bar
├─────────────────────────────────┤
│                                 │
│        Active Tool Panel        │  <- Dynamic Content
│                                 │
├─────────────────────────────────┤
│ 🔒 Zero tracking • 💾 Local    │  <- Footer
└─────────────────────────────────┘
```

### 主题系统

```ts
// CSS Variables
--halo - bg, --halo - bg - secondary, --halo - bg - tertiary;
--halo - text, --halo - text - secondary, --halo - text - muted;
--halo - border, --halo - accent, --halo - accent - hover;
--halo - success, --halo - error;
```

---

## §5 入口方式

| 入口     | 触发             | 说明               |
| :------- | :--------------- | :----------------- |
| 图标点击 | action.onClicked | 直接打开 SidePanel |
| 右键菜单 | contextMenus     | 页面/选择/链接     |
| 快捷键   | commands         | 🔜 待实现          |

---

## §6 代码规范 (ai-rules.md 摘要)

- 源码 ≤200 行 | index.ts ≤50 行
- 函数 >50 行预警 | 文件 >150 行预警
- 注释英文 | 仅写不可推导信息
- 禁硬编码 URL/规则表
