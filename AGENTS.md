# NEXUS agent instructions

<!-- gitnexus:keep -->

## Required sources

Read these before changing the repository:

1. [`rules.md`](rules.md): repository-wide constraints.
2. [`nexus/docs/README.md`](nexus/docs/README.md): documentation authority and domain owners.
3. The application or package owner document for the behavior being changed.
4. The relevant contracts, implementation, tests, production artifacts, and release gates.

Do not treat this file as a second copy of the rules. It is the agent entrypoint and generated skill index.

## Working boundary

- Primary workspace: `nexus/`.
- Runtime and package manager: the repository-pinned Bun toolchain.
- Use repository scripts rather than inventing parallel commands.
- Generated files are changed through their source/generator.
- Before editing a shared symbol, inspect callers, identities, lifecycle ownership, failure paths, tests, and release projections.
- Close behavior through contract, implementation, tests, owner documentation, and applicable privacy/release evidence.
- A roadmap, proposal, research note, redirect, or archived report is never implementation authority.

## Project skills

The source of truth is [`.agents/skills/`](.agents/skills/). `bun run sync:skills` refreshes the table between the markers below.

<!-- nexus:skills-start -->
| Skill | Description | Triggers |
|---|---|---|
| `compress-docs` | 精简 Markdown 文档而不损失 authority、因果、契约、锚点或历史证据。 | compress docs, 文档压缩, 压缩md, 无损压缩 |
| `release-halo` | 路由 HALO 候选到当前发布 owner，核对浏览器、权限、隐私、产物与授权状态。 | release halo, halo 发布, halo 上架 |
| `add-dependency` | 引入、替换或升级依赖时，核实必要性、唯一 owner、当前版本、安全与真实验证。 | add dependency, install package, upgrade package, 加依赖 |
| `verify` | 运行当前 NEXUS 架构验证 owner，解释规则失败并补齐验证器之外的证据。 | verify, check architecture, 架构校验, verify 一下 |
| `finish-feature` | 完成功能或修复时，核对真实闭环、适用门禁、文档投影与授权交付边界。 | finish feature, ship it, end task, 完工, 交付 |
| `lint` | 路由到 NEXUS 当前代码、文档和工具链静态门禁，并解释真实 owner 失败。 | lint, biome, 代码风格, 文档检查 |
| `typecheck` | 运行当前 TypeScript owner，并把错误追溯到契约、运行时 guard 与依赖方向。 | typecheck, ts check, 类型检查, ts 报错 |
| `new-module` | 创建新模块前证明真实 owner 边界、依赖方向、生命周期与验证入口。 | new module, create app, scaffold, 建模块, 新应用 |
| `test` | 按真实机制选择最小测试，并补足跨上下文、浏览器、生命周期或产物证据。 | test, run tests, 跑测试, e2e |
| `sync-nexus` | 使用当前受审计生成器投影 public 候选，并保护目标仓库、隐私和授权边界。 | sync nexus, push to public, 同步开源, sync spectra, sync halo |
| `release-spectra` | 路由 SPECTRA 候选到当前发布 owner，核对 Chrome、Remote、权限、隐私与物理产物。 | release spectra, spectra 发布, spectra 上架 |
| `update-context` | 把变更同步到唯一文档 owner 与必要公共投影，不复制规范。 | update context, sync docs, 更新文档, 文档同步 |
<!-- nexus:skills-end -->

## Stop conditions

Do not declare work complete while the diff contains a known broken link, duplicated authority, stale generated output, failing required check, unresolved lifecycle leak, unverified public claim, toolchain-version drift, or an unexplained change outside the requested scope.
