# HALO 架构 (v2.6.2)

> DNA: SidePanel-only | 零上传 | 原子化模块 | 本地优先 | 极致性能

## 📂 结构

```text
entry/: background(RPC), content(DOM), sidepanel.tsx(Entry)
components/: UI + _generated-tool-loader.ts + sidepanel/Context
kernel/: registry/(taxonomy,_generated), managers/(Perm/Module), core/
tools/: [id]/{manifest.json, panel.tsx, core.ts, locales/} → User Tools
system/: [id]/{manifest.json, panel.tsx, locales/} → System Components (settings/store/perms/monitor)
i18n/: locales/{zh,en}.ts + i18n-core.ts
```

## ⚙️ 双路注册体系

`generate-tool-registry.mjs` 双路扫描 → `_generated.ts`:

- `src/tools/*` → `USER_TOOL_REGISTRY`
- `src/system/*` → `SYSTEM_PLUGIN_REGISTRY`
- 产出: `ALL_APPS` (路由) + `PERMISSION_USAGE_MAP` (权限反查)

## 🌐 i18n 架构 (Flat Source, Nested Runtime)

**原则**: 工具自治 | SSOT | 扁平开发 | 嵌套运行

### 目录规范

```text
tools/<id>/locales/{en,zh}.ts  →  构建聚合  →  _generated-tools-*.ts  →  运行时 hydrate
```

### Key 格式 (必须扁平)

```typescript
// tools/qrcode/locales/en.ts
export const en = {
  "tools.qrcode.name": "QR Code",
  "tools.qrcode.desc": "Generate and scan",
  "qrcode.action.scan": "Scan Image", // 工具内部 key
};
```

### 运行时 Hydration

`hydrateTranslations()` 自动将 `'a.b.c': 'val'` → `{a:{b:{c:'val'}}}` 供 i18next 消费。

## 📏 规范

| 项目 | 标准                                                   |
| ---- | ------------------------------------------------------ |
| 行数 | 推荐 ≤150 \| 警告 >150 \| 红线 >200 (必须拆分)         |
| 模块 | core.ts(逻辑) / panel.tsx(UI) / index.ts(出口 ≤50)     |
| UI   | @nexus/ui-kit + CSS Vars \| 4px 网格 \| 禁动态 Padding |
| 图标 | Manifest 唯一数据源 (SSOT)，禁硬编码                   |

## 🚀 核心服务

- **Search**: `unified-search.ts` - 全语言/拼音/多字段/自动扩展
- **State**: `useToolState` - 原子化/跨窗口同步/防抖 (`halo_tool_state_${id}`)
- **Permissions**: `PermissionManager` - Manifest 声明式管理
- **SaaT**: `saat-service.ts` - Script-as-a-Tool 引擎
- **Perf**: EngineStatusProvider | Zero-Copy | detachNode | Visibility Pause
- **ResourceMonitor**: manifest.json → BACKGROUND_PROFILES_MAP → 全局监控

## 🔌 通信

RPC: `chrome.runtime.sendMessage` | Type-Safe ToolId (Registry Derived)

## 🧩 版本演进

| 版本 | 里程碑                                                 |
| ---- | ------------------------------------------------------ |
| v1.8 | PermissionManager + 去中心化 i18n                      |
| v2.0 | Playwright UI Test + Safe Storage                      |
| v2.2 | useToolState 原子化存储                                |
| v2.3 | Physical Isolation (tools/system) + SSOT Dual Registry |
| v2.4 | SaaT 架构 + i18n Flat Source                           |
| v2.6 | ResourceMonitor SSOT + 性能优化 (Polling → Event)      |
