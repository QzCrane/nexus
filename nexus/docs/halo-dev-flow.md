# HALO 开发流程

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

### 主题系统

```ts
// CSS Variables
(--halo - bg, --halo - bg - secondary, --halo - bg - tertiary);
(--halo - text, --halo - text - secondary, --halo - text - muted);
(--halo - border, --halo - accent, --halo - accent - hover);
(--halo - success, --halo - error);
```

---

## §5 入口方式

| 入口     | 触发             | 说明               |
| :------- | :--------------- | :----------------- |
| 图标点击 | action.onClicked | 直接打开 SidePanel |
| 右键菜单 | contextMenus     | 页面/选择/链接     |
| 快捷键   | commands         | 🔜 待实现          |
