# NEXUS AI Portal

**DNA**: Contracts ← Kernel ← {Audio-Engine} ← {Spectra, Halo}

---

## 指引

**任务准备**: plan.md(路线) → 模块定位 → contracts/.ai-context.md(通信)

**场景导读**:

- 音频模式 → apps/extension-spectra/docs/policy-decision.md
- 状态同步 → docs/cors-data-flow.md
- 新 Action → contracts/src/messages/definitions.ts
- 规则/依赖 → docs/ai-rules.md
- 开源同步 → `pnpm sync-public`

---

## 开源 (双仓库同步)

**每次开发完成后必须同步对应公共仓库**:

1. `git add + commit + push` (nexus)
2. `pnpm sync-spectra` 或 `pnpm sync-halo`
3. `cd ../spectra-public ; git push -f origin main`

**隔离策略**:

- `.git/info/exclude`: 排除 `*-public/` 避免主库追踪其物理文件
- `.vscode/settings.json`: `git.ignoredRepositories` 屏蔽子仓库 Git 状态干扰

nexus(私有) → {spectra, halo}-public/ → github.com/QzCrane/{spectra, halo}
排除: scripts/ docs/ .agent/ store-listings/ test/ assets/ \*.ai-context.md + 无关项目

---

## 英文迁移

新代码强制英文 | commit 英文 | `pnpm verify`检测

---

## 工作流

/feature-finish | /sync-nexus | /release-halo | /add-dependency | /new-module | /sync-spectra-public | /update-context

---

## 模块

包: 职责
@nexus/contracts: 类型定义源
@nexus/kernel: RPC+Storage+Log
@nexus/ui-kit: 共享 UI 组件
@nexus/audio-engine: WebAudio 链 (Zero-Copy 传输)
@nexus/spectra: 媒体扩展 (Popup)
@nexus/halo: 万能工具箱 (SidePanel - Centralized Status + Decentralized I18n)

---

## 功能

**SPECTRA**: Audio 800%/EQ/脉冲/声道/延迟 | AudioContext 劫持 (Google 翻译支持) | Video 速率 16x/旋转/镜像/PiP/截图 | AB 循环/标记 | 遥控 QR+WebRTC | 热键脚本 (UserScripts)

**HALO** (SidePanel 83 tools):

- 自动注册系统: `tools/*/manifest.json` + `locales/*` → `pnpm generate-registry` → 自动生成 `ToolId`, Source Map & I18n Aggregation
- 故障隔离: `ToolErrorBoundary` 确保单模块崩溃不影响全局
- 智能意图: `useClipboardIntent` 智能识别剪贴板内容并推荐工具 (Smart Paste)
- 核心服务: `useToolState`, `PermissionManager`(Kernel), `EngineStatusProvider`
- 搜索引擎: unified-search.ts (全语言+Pinyin 全拼/简拼+registerSearchLocale 扩展)
- 性能优化: `useIdlePreload` (空闲预加载), `waitForI18n` (Suspense-ready)
- Core(13): QR/Screenshot/Color/Ruler/JSON/Base64/Hash/UUID/Timestamp/URL/ModuleStore/Settings/Permissions
- Dev(34): **UserScripts(Pro:chrome.userScripts API,MAIN world,Templates)**/Regex/Crypto/Network/YAML/Markdown/JSONPath/SQL/Protobuf/...
- Efficiency(13): PDF/Clipboard(Monitoring)/Tabs/Timer/SmoothScroll(Pro)/...
- Security(5) + Media(3) + Browser(8)

---

## 协议

详见: `apps/extension-spectra/docs/protocols.md`

---

## 红线

Contracts 禁逻辑 | 源码 ≤200 行 | 禁绕 kernel 存储 | 禁触发 Layout Shift 的动态 Padding | 禁在工具内添加独立 Storage Listener | 频谱数据传输禁 Array.from | 必须执行资源 detach 销毁

---

## 验证 v5

`pnpm verify`: .ai-context | contracts 纯净 | 行数 150/200 | 硬编码 Action | HTML 引用 | 中文注释 | 依赖方向

---

## 测试

**UI 自动化**: Playwright + 持久化上下文 (chrome.storage/IndexedDB 超时降级内存模式)

命令: `pnpm test:playwright` (apps/extension-halo)

标准: safe-storage.ts (5s 超时) | i18n 超时 (2s) | ModuleManager 内存降级 (3s) | Zero-Leaking Detachment

---

## 索引

规则: docs/ai-rules.md
规划: plan.md, apps/extension-halo/plan.md, apps/extension-spectra/plan.md
架构: docs/cors-data-flow.md, apps/extension-halo/docs/architecture.md, apps/extension-spectra/docs/policy-decision.md
调研: apps/extension-halo/docs/research.md
模块: packages/{contracts,nexus-kernel,ui-kit}/.ai-context.md + packages/features/audio-engine/.ai-context.md + apps/{extension-spectra,extension-halo}/.ai-context.md

---

## 路线 2026

Q1 抢占(HALO 工具箱+标签) | Q2 AI(人声分离+识曲) | Q3 付费(PRO) | Q4 生态(移动+云)
