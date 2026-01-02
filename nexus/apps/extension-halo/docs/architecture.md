# HALO 架构 (v1.5.0)

> DNA: SidePanel-only | 零上传 | 原子化模块 (tools/)

## 📂 结构

- entry/: background(RPC), content(DOM), sidepanel.tsx(Entry)
- components/: UI + \_generated-tool-loader.ts(Mapping)
- kernel/: core/, registry/(\_generated.ts), managers/, hooks/
- tools/: [tool-name]/{manifest.json, panel.tsx, core.ts, .ai-context.md}
- i18n/: locales/ (zh.ts, en.ts)

## ⚙️ 自动化注册

tools/\*/manifest.json (82+) → pnpm generate-registry → \_generated.ts & loader.ts
新增: 创建 manifest + panel → pnpm build 自动注册

## 📏 规范

- 行数: 推荐 ≤150 | 警告 >150 | 红线 >200 (必须拆分)
- 模块: core.ts(逻辑) / panel.tsx(UI) / index.ts(出口 ≤50)
- UI: @nexus/ui-kit + CSS Vars | 4px 网格 | 禁用引起 Layout Shift 的动态 Padding

## 🚀 核心服务

- 搜索: ID/Name/Desc/Keywords/Pinyin 聚合检索
- i18n: Global Signal + Listener 同步，无需刷新重渲染
- 性能: EngineStatusProvider(Storage 广播) | Zero-Copy Data | detachNode(资源销毁)

## 🔌 通信

RPC: `chrome.runtime.sendMessage` | Action: `HALO_ACTION_NAME`
Format: `{ source: 'HALO', action: '...', data: ... }`
