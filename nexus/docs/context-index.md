# 上下文工程索引

**用途**: AI 记忆锚点，全部上下文文件路径与职责。

## 入口层

- .agent/rules/nexus.md: 规则触发器，指向主入口
- nexus/README.AI.md: 主入口，场景导读+模块映射
- plan.md: 功能路线图与实施状态

## 规则层 (docs/ai-rules/)

- architectural.md: 依赖链+职责边界
- code-quality.md: 行数限位+拆分信号
- documentation.md: 压缩规范
- security.md: 凭证+权限红线

## 架构层 (apps/extension-spectra/docs/)

- policy-decision.md: 模式决策矩阵
- cors-data-flow.md: CORS 探测流程

## 模块层 (.ai-context.md)

- packages/contracts/: 纯类型层
- packages/nexus-kernel/: RPC+Storage+日志
- packages/features/audio-engine/: WebAudio 节点链
- apps/extension-spectra/: 扩展顶层上下文
- └─ src/popup/: Popup UI
- └─ src/content/: Content Script
- └─ src/background/: Service Worker
- └─ src/content/policy-executor/: CORS 检测+模式切换
- └─ src/content/lifecycle/: 定时器+观察器

## 历史层 (docs/migration/)

- strategy-refactor-v2.md: ✅ 完成
- fix-audiocontext-policy.md: ✅ 验证

## 工作流 (.agent/workflows/)

- /feature-finish: 交付门禁
- /add-dependency: 引入依赖
- /new-module: 新建模块
- /release-spectra: 发布扩展
