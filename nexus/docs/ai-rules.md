# AI Rules

## §0 压缩原则 (第一优先)

**目标**: 极限省 token 无损压缩

核心: 完整性>行数 | 压缩表述不压缩信息 | 模块仅含必需信息

格式: 避免一切 md 表格，不重复，不装饰，强约定，字段名用 `字段1: 字段2: 字段3`，每行记录对应 `A: B：C` | 流程用`→`链 | 约束用`-`

禁词: 请注意/建议/的时候/进行/执行/相关的/可以/能够/应该 → 直接陈述

技巧: 代码单行`{a,b}` | 表格删对齐 | 列表用`/`合并 | 重复用`→见[文件]`

---

## §1 架构

依赖链: Contracts ← Kernel ← {Audio-Engine, UI-Kit} ← {Spectra, Halo}

导入: 允许包入口+上引下 | 禁止深层/循环/下引上

职责: Contracts(纯类型) | Kernel(RPC+存储+日志) | UI-Kit(共享组件) | Audio-Engine(WebAudio) | Spectra(媒体 UI+Chrome) | Halo(效能 UI+Chrome)

策略: 禁硬编码 URL/规则表 | 仅 WebAudio 行为判断

---

## §2 代码

提前计划好拆分子文件再编写，避免刚写完就拆分
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

bun workspace | `bun install` & `bun run build` (apps/packages) | 内部包: `"@nexus/x": "workspace:*"`

构建: esbuild 统一 | `--dev` 不压缩 | `--watch` 实时监视 | verify-architecture 自动执行

依赖规则: 同类禁重复 | 安装登记清单 | 删除同步更新

### 依赖清单

运行时: qrcode^1.5(QR) peerjs^1.5(WebRTC) jose^6.x(JWT/Crypto) @2025-12-31
开发时: esbuild^0.21(构建) @types/qrcode^1.5 @2025-12-26

---

## §5 开源

双仓库: nexus(私有) → {spectra, halo}-public | `bun run sync-spectra` / `bun run sync-halo`
排除: scripts/ docs/ .agent/ store-listings/ test/ assets/ \*.ai-context.md plan.md
规则: 公开库禁包含 AI context / 脚本 / 内部文档 / 历史 commit

**Git 排除规则**:

1. `git add + commit + push` (nexus)
2. `bun run sync-spectra` 或 `bun run sync-halo`
3. `cd ../spectra-public ; git push -f origin main`

**隔离策略**:

- `.git/info/exclude`: 排除 `*-public/` 避免主库追踪其物理文件
- `.vscode/settings.json`: `git.ignoredRepositories` 屏蔽子仓库 Git 状态干扰

---

## §6 语言

新代码强制英文 | commit 英文 | `bun run verify`检测

---

## §7 UI & UX

稳定性: 禁引起 Layout Shift 的动态 Padding | 优先用 CSS `margin: auto` 居中
交互性: 穿透层用 `pointer-events: none` | 事件捕获层用透明 `Hit Area`
绿标 (Env Badge): 仅限具有 Background Engine 且有 Master Toggle 的工具 (如 Scroll/UserScript/Clipboard)
中心化状态: 强禁在工具组件内添加 Storage 监听 | 必须消费 `EngineStatusProvider` 广播
音频零拷贝: 可视化数据传递强禁 `Array.from` | 必须直接传递或使用 `TypedArray` 映射 | 预分配 Buffer
极致性能: Hot Path 禁闭包分配 | 循环内禁 alloc | 高频事件必须 Debounce/Throttle/rAF | 算法优先 O(1)/O(N) 线性扫描
裁剪消除: 缩放元素必须预留 `MAGNIFY_HEADROOM` (30px+) | 禁用 `overflow: hidden` 在感应父级
资源清理: 必须在 DOM 移除时执行 `detachNode` | 强禁 WebAudio 节点在 SPA 中累积
i18n: 禁硬编码字符串 | 必须下沉至工具目录 (SSOT) | 必须支持全局实时同步

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
命令: `bun run test:playwright` → 截图到 `test/screenshots/`
红线: 禁直接调用 chrome.storage (必须用 safeStorageGet/Set) | 初始化 Promise 必须有超时

## §9 设计原则

## 1. C.S.O (金融基石)

### 1.1 一致性 (Consistency)

- **LogSource**: Engine (Redis Pub) 唯一信源，禁 API 层双写
- **Timezone**: Docker `tzdata` 强制 `Asia/Shanghai`，禁应用层补丁
- **State**: 前端持仓 === 引擎内存 === 数据库
- **Idempotency**: 核心写操作幂等 (RequestID 防重放)
- **Precision**: 资金计算用 `Decimal`，禁 Float

### 1.2 安全性 (Security)

- **ZeroTrust**: 策略容器无公网权限 (deny all)
- **SecretIsolation**: API Key 仅内存流转，绝不落盘
- **ResourceLimit**: Docker 必须 `--cpus` `--memory`

### 1.3 可观测性 (Observability)

- **Logs**: Terminal (本地) | Redis Stream (业务)
- **KernelLog**: `NAUTILUS_LOG_LEVEL` 源头控制，禁进 Redis
- **Traces**: Order→Exchange 全链路追踪 ID
- **Metrics**: Redis 队列 Lag + Heartbeat

### 1.4 确定性 (Determinism)

- **Backtest**: 固定 Seed + 固定时区 + 隔离环境 = 100% 可重复
- **Serialization**: MsgPack Safe Mode (`default=str`)

## 2. 三高 (High Architecture)

### 2.1 高可用 (HA)

- **Retry**: Redis/DB 断连自动重试 (Retry+Keepalive)
- **Stateless**: API/Engine 无状态，挂掉重启即恢复
- **AsyncPersistence**: 落盘不依赖实时在线 (Stream Storage)
- **FailFast**: 启动检查失败立即崩溃，拒绝"带病运行"

### 2.2 高性能 (HP)

- **BinaryIPC**: MsgPack 替代 JSON
- **NativeCore**: 核心计算下沉 Rust/C++
- **ZeroCost**: 抽象零开销 (>5%性能损失则拒绝)
- **NonBlocking**: IO 密集型必须异步

### 2.3 高并发 (HC)

- **Pooling**: Docker 容器池化 (BullMQ)
- **Isolation**: 策略实例完全隔离，无锁设计

## 3. 两性 (Nature)

### 3.1 高维护性 (Maintainability)

- **SSOT**: 禁跨层级状态复制
- **Explicit**: 显式类型 > 隐式推断；显式报错 > 静默吞没
- **Flat**: `src/features/[feature]/` (非铺平非深嵌套)
- **Atomic**: 模块/函数只做一件事 (SRP)
- **Dependency**: UI → API → Domain (Inward Rule)

### 3.2 高扩展性 (Extensibility)

- **InterfaceDriven**: 核心逻辑依赖抽象接口
- **Plugin**: 策略动态加载，无需重打包镜像

## 4. 红线

- ❌ API 层 Log 双写
- ❌ 应用层时区补丁
- ❌ Float 资金计算
- ❌ 无 RequestID 的写操作
- ❌ JSON IPC 通信
- ❌ 阻塞式 IO
- ❌ 静默吞没错误
- ❌ 核心层依赖外层

---

## §10 Spectra 扩展专项规则

### 10.1 单一事实来源 (SSOT)

- **常量定义**: 业务常量必须在 `@nexus/kernel` 或 `src/{module}/constants.ts` 唯一定义
- **默认值**: 禁止多处定义 `DEFAULT_XXX`，统一从 kernel 导入
- **URL**: 禁止硬编码，统一放入 `constants.ts`
- **导入路径**: `import { X } from '@nexus/kernel'` > 本地重新定义

### 10.2 懒加载策略

- **非首屏组件**: 必须使用动态导入 `await import('./module')`
- **视觉模块**: `visualizer`, `remote`, `side-panel` 延迟加载
- **首屏必需**: 仅保留核心 UI 初始化代码

### 10.3 性能优化

- **Tree Shaking**: 启用 `treeShaking: true`，移除死代码
- **代码分割**: 按功能分割，popup 非首屏懒加载
- **包大小预算**: popup < 200KB, content < 150KB, >1MB 告警
- **零拷贝**: 音频数据 `ArrayBuffer` 转移所有权，禁 `Array.from`
- **GC-Free**: 视觉循环零分配，预分配 Buffer

### 10.4 Chrome 扩展安全

- **上下文守卫**: 所有 Chrome API 调用前检查 `isExtensionContextValid()`
- **错误处理**: `void chrome.runtime.lastError` 或 `.catch(() => {})`
- **存储超时**: 使用 `safe-storage.ts` 包装，2s 超时降级内存
- **CORS**: 探测依赖 User Gesture，敏感 API 走 Background

### 10.5 代码组织

- **分层**: `content/{core,logic,audio,video,input,ui}`
- **文件大小**: 源码 ≤200 行，index.ts ≤50 行，>150 行预警
- **职责**: 单文件单职责，目录深度 ≤3
- **预检**: 修改前 `Pre-check lines` + `Pre-check tree`

### 10.6 审查清单

- [ ] 无重复 `const DEFAULT_` 定义
- [ ] 无硬编码 URL/字符串
- [ ] 懒加载路径正确
- [ ] 类型检查通过 `tsc --noEmit`
- [ ] 构建成功 `bun run build`
- [ ] 包大小符合预算
