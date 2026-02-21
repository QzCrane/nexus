# NEXUS AI Portal

**DNA**: Contracts ← Kernel ← {Audio-Engine} ← {Spectra, Halo}

## 指引

任务准备: plan.md(路线) → 模块定位 → 场景架构

场景导读: 音频模式 →spectra/docs/policy-decision.md | 状态同步 →spectra/docs/cors-data-flow.md | 新 Action→contracts/src/messages/definitions.ts | 规则/依赖 →docs/ai-rules.md

## 开源

双仓库: nexus(私有) → {spectra,halo}-public | `bun run sync-{spectra,halo}` → `cd ../*-public; git push -f`
排除: scripts/ docs/ .agent/ store-listings/ test/ assets/ _.ai-context.md plan.md
隔离: `.git/info/exclude`排除`_-public/`|`.vscode/settings.json`屏蔽子仓库 Git 状态

## 模块

@nexus/contracts(类型) | @nexus/kernel(RPC+Storage+Log) | @nexus/ui-kit(共享 UI) | @nexus/audio-engine(WebAudio 零拷贝)
@nexus/spectra(媒体扩展 Popup) | @nexus/halo(万能工具箱 SidePanel)

## 功能

**SPECTRA**: Audio 800%/EQ/压缩/声道 | AudioContext 劫持 | Playback Rate 双向同步 | Video 速率 16x/旋转/PiP/截图 | AB 循环 | 预设管理(Global/Site) | 遥控 QR+WebRTC | 热键脚本

**HALO** (85 tools): 自动注册(`manifest.json`+`locales/`→`bun run generate-registry`) | 故障隔离(`ToolErrorBoundary`) | 智能意图(`useClipboardIntent`) | 搜索(Pinyin 全拼/简拼) | 性能(IdlePreload/VisibilityPause/EventDriven) | 资源监控(11 种 CPU 机制)
Core(13) | Dev(34,含 UserScripts Pro) | Efficiency(13) | Security(5) | Media(3) | Browser(8)

## 红线

Contracts 禁逻辑 | 源码 ≤200 行 | 禁绕 kernel 存储 | 禁动态 Padding(Layout Shift) | 禁工具内 Storage Listener | 频谱禁 Array.from | 必须 detach 销毁 | 禁 setInterval 轮询(事件驱动) | 定时器必须 visibility 暂停 | 后台 CPU 消耗必须 manifest 注册

## 验证/测试

`bun run verify`: .ai-context | contracts 纯净 | 行数 150/200 | 硬编码 Action | HTML 引用 | 中文注释 | 依赖方向
`bun run test:playwright`: Playwright 持久化上下文 | safe-storage(5s 超时) | i18n(2s) | ModuleManager(3s 降级)

## 索引

规则: docs/ai-rules.md | 商业: docs/business-model.md
规划: plan.md + apps/{extension-halo,extension-spectra}/plan.md
架构: apps/extension-halo/docs/{architecture,research,plan-hover-zoom-v2}.md | apps/extension-spectra/docs/{policy-decision,protocols,cors-data-flow}.md

## 路线 2026

Q1 抢占(HALO 工具箱) | Q2 AI(人声分离+识曲) | Q3 付费(PRO) | Q4 生态(移动+云)
