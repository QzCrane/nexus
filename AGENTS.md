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
- Runtime and package manager: **Bun 1.3.14**.
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
| `add-dependency` | 引入或升级依赖的标准流程：查重、当前版本/许可/CVE 核验、最窄 workspace 安装、验证与边界记录。 | add dependency, install package, upgrade package, 加依赖 |
| `compress-docs` | 压缩工程内的 Markdown 文档，分为自动化无损去空行和深度语义精简两步。 | compress docs, 文档压缩, 压缩md, 无损压缩 |
| `finish-feature` | 完成功能或修复时执行交付闭环：范围审计、聚焦测试、Bun 1.3.14 与文档/架构门禁、隐私和发布投影同步，并按用户授权提交或推送。 | finish feature, ship it, end task, 完工, 交付 |
| `lint` | 运行 NEXUS 的 Biome、workspace fallback、SPECTRA release、Markdown 权威图和 Bun 1.3.14 检查，并区分检查与自动修复。 | lint, biome, 代码风格, 文档检查 |
| `new-module` | 创建新的 workspace 包、应用或有明确边界的模块：先定义 owner/依赖方向，再脚手架、接入构建与验证。 | new module, create app, scaffold, 建模块, 新应用 |
| `release-halo` | 执行 HALO 发布准备与候选包审计：文档与 Bun 1.3.14 门禁、版本、registry/permission、生产构建、SidePanel/Playwright、隐私与商店材料、可选 public 同步。 | release halo, halo 发布, halo 上架 |
| `release-spectra` | 执行 SPECTRA 发布闭环：文档与 Bun 1.3.14 门禁、版本与工作树审计、生产打包、Chrome/远程/隐私/商店文案核对、可选 public 同步。 | release spectra, spectra 发布, spectra 上架 |
| `sync-nexus` | 使用受审计的同步脚本生成 SPECTRA 或 HALO public 仓库候选：验证私库、保留目标 .git、过滤复制、强制 Bun 1.3.14、构建、审查单个生成提交，再按授权推送。 | sync nexus, push to public, 同步开源, sync spectra, sync halo |
| `test` | 按变更机制选择 NEXUS 聚焦测试、SPECTRA Chrome 测试或 HALO UI/Playwright 测试，并补足生命周期与生产构建证据。 | test, run tests, 跑测试, e2e |
| `typecheck` | 运行全 workspace、SPECTRA 依赖闭包或单包 TypeScript 检查，并把类型错误追溯到契约与运行时边界。 | typecheck, ts check, 类型检查, ts 报错 |
| `update-context` | 将代码或产品变更同步到唯一 owner、入口、路线图、隐私/商店投影和历史证据，并修复链接与漂移。 | update context, sync docs, 更新文档, 文档同步 |
| `verify` | 运行 NEXUS 架构验证器的快速、默认或详细模式，解释具体规则失败，并补足不在该脚本内的测试/构建/文档检查。 | verify, check architecture, 架构校验, verify 一下 |
<!-- nexus:skills-end -->

## Stop conditions

Do not declare work complete while the diff contains a known broken link, duplicated authority, stale generated output, failing required check, unresolved lifecycle leak, unverified public claim, toolchain-version drift, or an unexplained change outside the requested scope.
