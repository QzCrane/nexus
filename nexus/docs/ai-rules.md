# AI Rules

## §0 压缩原则 (第一优先)

**目标**: 极限省 token 无损压缩

核心: 完整性>行数 | 压缩表述不压缩信息 | 模块仅含必需信息

格式: 避免一切 md 表格，不重复，不装饰，强约定，字段名用 `字段1: 字段2: 字段3`，每行记录对应 `A: B：C` | 流程用`→`链 | 约束用`-`

禁词: 请注意/建议/的时候/进行/执行/相关的/可以/能够/应该 → 直接陈述

技巧: 代码单行`{a,b}` | 表格删对齐 | 列表用`/`合并 | 重复用`→见[文件]`

---

## §1 架构

依赖链: Contracts ← Kernel ← {Audio-Engine, Zen-Engine, UI-Kit} ← {Spectra, Halo}

导入: 允许包入口+上引下 | 禁止深层/循环/下引上

职责: Contracts(纯类型) | Kernel(RPC+存储+日志) | UI-Kit(共享组件) | Audio-Engine(WebAudio) | Zen-Engine(效能/美学) | Spectra(媒体 UI+Chrome) | Halo(效能 UI+Chrome)

策略: 禁硬编码 URL/规则表 | 仅 WebAudio 行为判断

---

## §2 代码

硬限: 源码 ≤200 行 | index.ts≤50 行 | 函数>50 行预警 | 文件>150 行预警
结构: `module/{index.ts, types.ts, core.ts, [feature].ts}`
红线: >200 行禁新增 | 单文件单职责 | 目录深度 ≤3
预检: 修改前必须 `Pre-check lines` (近 200 行则先重构) | 必须 `Pre-check tree` (确认相对路径)

## §2.1 注释规则

[Logic]
Default: ∅ (不写)
Priority: Rename > Type/Constraint > Effect > Why > None
Valid: Atomic(line) ∧ Head ∧ Non-derivable(English)

[Scope & Fields]
File (Module/Pkg) : {goal, tradeoff, ban, risk}
Func (Fn/Method) : {pre, post, inv, eff}
Line (Stmt/Expr) : {inv, rule, @tag}

[Filter]
Discard IF:

- Info derivable from Code/Naming/Type (信息可推导)
- Pure & self-explanatory (无副作用且自解释)
- Noise: Line-by-line | Emotion | TODO | Old-code | Author

[Validation]
Write ONLY IF:

- Cannot be derived (不可推导) OR
- Constrains future dev (限制未来) OR
- Deletion causes error (删除致错)

[Output]
Template: `// field: <content>`

---

## §3 安全

零硬编码 Key/Token(用 env) | 日志脱敏 | 权限仅 storage/scripting/offscreen | 禁 history/bookmarks/eval

---

## §4 环境

pnpm workspace | `pnpm install/build/--filter [name] build` | 内部包: `"@nexus/x": "workspace:*"`

依赖规则: 同类禁重复 | 安装登记清单 | 删除同步更新

### 依赖清单

运行时: qrcode^1.5(QR) peerjs^1.5(WebRTC) jose^6.x(JWT/Crypto) @2025-12-31
开发时: @types/qrcode^1.5 @2025-12-26

---

## §5 开源

双仓库: nexus(私有) → {spectra, halo}-public | `pnpm sync-spectra` / `pnpm sync-halo`
排除: scripts/ docs/ .agent/ store-listings/ test/ assets/ \*.ai-context.md plan.md
规则: 公开库禁包含 AI context / 脚本 / 内部文档 / 历史 commit

---

## §6 语言

## 新代码强制英文 | commit 英文 | `pnpm verify`检测

---

## §7 UI & UX

稳定性: 禁引起 Layout Shift 的动态 Padding | 优先用 CSS `margin: auto` 居中
交互性: 穿透层用 `pointer-events: none` | 事件捕获层用透明 `Hit Area`
绿标 (Env Badge): 仅限具有 Background Engine 且有 Master Toggle 的工具 (如 Scroll/UserScript/Clipboard)
中心化状态: 强禁在工具组件内添加 Storage 监听 | 必须消费 `EngineStatusProvider` 广播
音频零拷贝: 可视化数据传递强禁 `Array.from` | 必须直接传递或使用 `TypedArray` 映射
裁剪消除: 缩放元素必须预留 `MAGNIFY_HEADROOM` (30px+) | 禁用 `overflow: hidden` 在感应父级
资源清理: 必须在 DOM 移除时执行 `detachNode` | 强禁 WebAudio 节点在 SPA 中累积
i18n: 禁硬编码字符串 | 必须登记在 `locales/*` | 系统页面必须支持全局实时同步

### 工具面板设计原则 (Halo ToolPanel)

核心: 高可用 | 直观易用 | 美观优雅 | 信息铺开 | 减少交互次数

铺开原则:

- 多结果工具 (Hash/编解码) 必须同时展示所有结果，禁用 Tab/下拉切换
- 格式转换工具 (Timestamp/Color) 必须一次性展示所有格式
- 编解码工具 (Base64/URL) 自动检测方向，同时显示 encode/decode
- 实时响应: 输入即计算，禁"提交"按钮 (除非有副作用)

交互简化:

- 首屏必须展示核心功能，无需滚动
- 复制按钮紧贴结果，单击即复制 (带 toast 反馈)
- 历史记录可选显示，默认折叠

---

## §8 测试

策略: Playwright + 持久化上下文 | chrome.storage/IndexedDB 不可靠时超时降级内存
模式: `safe-storage.ts` 包装 chrome.storage (2s 超时返回默认值)
扩展: ModuleManager 3s 超时切换内存模式 | i18n 2s 超时使用浏览器 locale
命令: `pnpm test:playwright` → 截图到 `test/screenshots/`
红线: 禁直接调用 chrome.storage (必须用 safeStorageGet/Set) | 初始化 Promise 必须有超时
