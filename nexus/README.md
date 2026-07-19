# Nexus Workspace

The central monorepo for QzCrane's browser extension ecosystem.

**DNA**: Contracts ← Kernel ← {Audio-Engine} ← {Spectra, Halo}

## Projects

- **[Spectra](./apps/extension-spectra/README.md)**: Professional Audio/Video Controller & WebRTC Remote.
- **Halo**: (In Development) SidePanel All-in-One Toolkit.
- **Cortex**: (Planned) AI Assistant.

## Architecture

- **Kernel**: Centralized state management & RPC.
- **Contracts**: Shared type definitions and protocol messages.
- **Audio-Engine**: WebAudio API chain management.

## Modules

@nexus/contracts(类型) | @nexus/kernel(RPC+Storage+Log) | @nexus/ui-kit(共享 UI) | @nexus/audio-engine(WebAudio 零拷贝)
@nexus/spectra(媒体扩展 Popup) | @nexus/halo(万能工具箱 SidePanel)

## Features

**SPECTRA**: Audio 800%/EQ/压缩/声道 | Native-first 音频增强/Capture fallback | Playback Rate 双向同步(站点 one-shot adapter) | Video 速率 16x/旋转/PiP/截图 | AB 循环 | 预设管理(Global/Site) | 遥控 QR+WebRTC | 冷文档快捷键/标准 Toast | 零刷新热更新(scripting+sentinel)

**HALO** (85 tools): 自动注册(`manifest.json`+`locales/`→`bun run generate-registry`) | 故障隔离(`ToolErrorBoundary`) | 智能意图(`useClipboardIntent`) | 搜索(Pinyin 全拼/简拼) | 性能(IdlePreload/VisibilityPause/EventDriven) | 资源监控(11 种 CPU 机制)
Core(13) | Dev(34,含 UserScripts Pro) | Efficiency(13) | Security(5) | Media(3) | Browser(8)

## Open Source

双仓库: nexus(私有) → {spectra,halo}-public | `bun run sync-{spectra,halo}` → `cd ../*-public; git push -f`
排除: scripts/ docs/ .agent/ store-listings/ test/ assets/ plan.md
隔离: `.git/info/exclude`排除`_-public/`|`.vscode/settings.json`屏蔽子仓库 Git 状态

## Red Lines

Contracts 禁逻辑 | 源码 ≤200 行 | 禁绕 kernel 存储 | 禁动态 Padding(Layout Shift) | 禁工具内 Storage Listener | 频谱禁 Array.from | 必须 detach 销毁 | 禁 setInterval 轮询(事件驱动) | 定时器必须 visibility 暂停 | 后台 CPU 消耗必须 manifest 注册

## Verification / Tests

`bun run verify`: contracts 纯净 | 行数 150/200 | 硬编码 Action | HTML 引用 | 中文注释 | 依赖方向
`bun run test:playwright`: Playwright 持久化上下文 | safe-storage(5s 超时) | i18n(2s) | ModuleManager(3s 降级)
`bun run test:unit`: spectra Registry 单元测试 (7 tests)
`bun run typecheck`: 全包 TypeScript 类型检查

## Index

规则: [AGENTS.md](../AGENTS.md) + [docs/engineering-principles.md](docs/engineering-principles.md) | 商业: docs/business-model.md
规划: plan.md + apps/extension-halo/PLAN.md + apps/extension-spectra/plan.md
架构: apps/extension-halo/docs/{research,plan-hover-zoom-v2}.md | apps/extension-spectra/docs/{control-architecture,architecture,protocols,cors-data-flow}.md
工程同步: docs/engineering-principles.md | apps/extension-spectra/docs/_archive/2026-Q3/

## Message Cheatsheet (Top 5)

`AUDIO_GET_STATUS` · `AUDIO_SET_CONFIG` · `CAPTURE_TOGGLE` · `SETTINGS_UPDATE` · `REGISTRY_QUERY_DOMAIN`
详见 [packages/contracts/src/messages/definitions.ts](packages/contracts/src/messages/definitions.ts)

## Roadmap 2026

Q1 抢占(HALO 工具箱) | Q2 AI(人声分离+识曲) | Q3 付费(PRO) | Q4 生态(移动+云)
