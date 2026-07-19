---
type: explanation
status: stable
audience: contributor
---

# 04. Process & quality gate (EPR-026..029 + 运行时检查清单)

> 主题 owner: 测试覆盖、提交闭环、文案真实性、Git/CI/AI 钩子,以及改前/改后/发布前的运行时检查清单。
> 完整目录: [engineering-principles.md](../engineering-principles.md)

## EPR-026: 测试必须覆盖时序和真实浏览器语义

单元测试验证纯函数和边界;契约测试验证协议/i18n/权限;状态机测试覆盖随机导航、媒体插入、source 替换、Popup、快捷键、processor handoff、dispose、重启和更新;Chrome smoke 必须覆盖真实 `event.isTrusted`、PiP activation、fullscreen、MutationObserver、source replacement、hidden tab、worker restart 和 ZIP 产物。类型检查或测试变绿不能单独证明架构完成。

## EPR-027: 每个提交形成一个可回滚闭环

一个 commit 至少同时包含契约、实现、测试和文档中的必要闭环;改动前先定位 owner、调用方、runtime domain 和失败处理者,改动后运行局部测试、完整测试、真实 Chrome、architecture gate 和 diff 检查。历史报告必须标记日期、基线、验证范围和剩余风险,不得把旧数字当作当前状态。

## EPR-028: 对外文案不得超过已证明能力

"所有网站""零 CPU""任何受保护媒体稳定工作""完全不传输数据"等绝对句式只有在浏览器能力和发布门真正证明时才能出现。原生失败、权限、activation、CORS、DRM、闭合 Shadow DOM 和不支持站点必须允许结构化 unsupported;营销文案不能把内部 Capture 或站点 adapter 扩大成普遍保证。

## EPR-029: 质量门硬化到 Git/CI/AI 钩子,文档风格靠 lint 守

- **Git 钩子**(Lefthook,Go 实现,毫秒级)必须在所有协作者本地安装:`bun run prepare` -> `bunx lefthook install`。
  - `pre-commit`:staged 文件跑 `lint-docs` + `biome check`,脏代码无法进入历史。
  - `commit-msg`:commitlint 强制 Conventional Commits(`feat/fix/refactor/perf/docs/test/build/ci/chore/...`),AI 生成的 commit 也必须守规矩。
  - `pre-push`:跑全量 `verify:q`(架构校验),阻塞破损 push。
  - `post-merge`:`sync:skills` 重新生成技能表 + 重建 AGENTS/CLAUDE 硬链接。
- **Markdown 文档**必须含 Diátaxis frontmatter(`type`/`status`/`audience`),由 `lint-docs.mjs` 校验,新文档无 frontmatter 拒绝提交。
- **CI** 复用同一组脚本:Turbo pipeline + lefthook 共享 `lint` / `typecheck` / `verify:q` 入口。
- **Claude Code / Antigravity hooks** 可选扩展(PreToolUse 拦截危险写,PostToolUse 自动 lint),但本地 Git 钩子是底线,缺它不算工程化。

## 5. 运行时检查清单

### 改代码前

- 明确文件属于 authority、projection、transport、executor、adapter、storage 还是 test。
- 写出它拥有的 identity、revision、generation、lease 和失败处理者。
- 用 GitNexus 查询调用链和上游影响;共享 symbol 先做 impact。
- 找到唯一 owner 文档和现有静态检查,不在第二个文档复制规则。

### 改代码后

- 更新 contracts、实现、测试和 owner 文档。
- 验证无第二 writer、无无身份 Runtime、无跨域 stale ACK、无默认值伪 actual。
- 运行定向单元/契约、全量单元、typecheck、lint、build、Chrome dev smoke、production ZIP smoke、architecture gate 和 `git diff --check`。
- 用 `detect_changes(scope="all")` 审计实际影响范围。

### 发布前

- 检查 PR/branch 是否包含完整闭环,历史报告数字是否明确标注时间。
- 检查 manifest 权限、隐私政策、store listing、remote-site 字节/CSP/MIME 与实际产物一致。
- 检查默认页面没有 AudioContext、Capture、analyser、offscreen 或周期性 IPC。
- 检查所有远端状态都由 ACK/Snapshot 驱动,未认证远程端没有状态和命令通道。
