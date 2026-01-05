# HALO 架构 (v2.4.0)

> DNA: SidePanel-only | 零上传 | 原子化 | 本地优先 | 极致性能

## 结构

```
src/
├─ entry/: background, content, sidepanel.tsx
├─ components/: UI + _generated-tool-loader.ts + sidepanel/
├─ kernel/{registry(_generated,taxonomy,module), managers(Perm/Module), services(saat)}
├─ tools/[id]/{manifest.json, panel.tsx} → pluginType:'tool'
├─ scripts/[id]/{manifest.json, script.js} → pluginType:'script'
├─ system/[id]/{manifest.json, panel.tsx} → pluginType:'system'
└─ i18n/{locales/, _generated-tools-*.ts}
```

## 插件架构

pluginType: `tool`(面板) | `script`(SaaT,嵌套`script:{type,matches,runAt}`) | `system`(设置/商店/权限)

分类(SSOT): 虚拟(active,scripts,system) → 功能(general,encode,format,network,data,dev,efficiency,browser,visual,media,security,ai)

排序: active → scripts → system → 功能分类

Registry 产出: `PLUGIN_REGISTRY` | `BACKGROUND_PLUGIN_IDS` | `get{Tool,Script,System}Plugins()`

## 规范

行数: ≤150 推荐 | >150 警告 | >200 必拆
模块: `{core.ts, panel.tsx, index.ts(≤50)}`
类型: `PluginMeta`(统一) / `ToolMeta`(别名)

## 核心服务

搜索: unified-search.ts(多语言/拼音) | i18n: 去中心化+自动聚合 | 状态: useToolState(原子隔离) | 权限: PermissionManager(声明式) | SaaT: saat-service.ts

## i18n 架构

原则: 工具自治 | SSOT | 扁平源码 | 嵌套运行时

流程: 开发(扁平 Key `tools.qrcode.name`) → 构建(扫描`src/{tools,system}/*/locales`生成`_generated-tools-*.ts`) → 运行(hydrateTranslations 还原嵌套)

目录: `src/tools/[id]/locales/{en,zh}.ts` 独立维护 → `src/i18n/locales/`聚合

格式: 必须扁平 Key(`"tools.my-tool.name": "My Tool"`) | 禁嵌套 tools 对象(防覆盖)

使用: `t('tools.${toolId}.name')` | `t('myTool.action.save')`

优势: 解决合并冲突 | 兼容 i18next 标准查找

## 动画系统 (v2.5.0)

位置: `src/components/ui/animated-transition/` | `public/sidepanel.html`(keyframes)

组件: `SimpleTransition`(CSS 过渡) | `AnimatedTransition`(状态驱动,复杂场景)

全局 Keyframes: `slideInFromRight` | `slideInFromLeft` | `fadeInUp`

配置: `HaloSettings.enableAnimations`(开关) | `animationSpeed`(fast/normal/slow)

实际使用:

- **Home↔Tool**: `LauncherLayout` 使用 `translateX` + CSS transition (0.3s)
- **子页面**: `ScriptEditorPage` 使用 CSS animation `slideInFromRight` (0.28s)
- **Tab 切换**: 暂无动画 (保持稳定性优先)
