---
name: new-module
description: 创建新的 workspace 包、应用或有明确边界的模块：先定义 owner/依赖方向，再脚手架、接入构建与验证。触发短语:"new module", "create app", "scaffold", "建模块", "新应用"。
license: Proprietary. See LICENSE.txt
compatibility: Requires Bun 1.3.14
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Write Edit Grep
---

# New module

## Trigger

Use when a new package, application, plugin family, or independently owned runtime module is genuinely required.

## Process

### 1. Prove the boundary

Before creating files:

- read [`rules.md`](../../../rules.md), [`nexus/docs/README.md`](../../../nexus/docs/README.md), and neighboring owners;
- confirm an existing package/module cannot naturally own the behavior;
- define responsibility, public API, dependency direction, state/lifecycle owner, failure boundary, and tests;
- decide whether the unit is a workspace package, application-internal module, HALO plugin, or SPECTRA capability implementation.

A new directory is not an architecture boundary by itself.

### 2. Scaffold at the correct level

For a new workspace package/application, run from `nexus/`:

```bash
mkdir -p packages/<name>
# or
mkdir -p apps/<name>
```

Create `package.json` deliberately. Use:

- a unique `@nexus/<name>` package name;
- `private: true` unless publication is explicitly designed;
- `type: "module"`;
- `packageManager: "bun@1.3.14"` only when the new directory is an independent package-manager root;
- scripts required by the workspace gates;
- dependencies only at the owning package.

A package normally extends the appropriate TypeScript base config. Confirm the actual relative path instead of copying one depth blindly.

For HALO plugins, follow [`apps/extension-halo/docs/architecture.md`](../../../nexus/apps/extension-halo/docs/architecture.md) and executable registry metadata. For SPECTRA, add a unit only within an existing capability owner unless the control contracts and [`docs/control/README.md`](../../../nexus/apps/extension-spectra/docs/control/README.md) define a new boundary.

### 3. Connect the build graph

- Confirm `nexus/package.json` workspace globs include the path.
- Add public exports and Turbo/package scripts required by actual consumers.
- Keep contracts free of application behavior and avoid reverse imports.
- Run `bun install` to refresh workspace links and `bun.lock`.
- Do not add a manual inventory duplicating manifests or registries.

### 4. Add tests and documentation

- Add focused tests for the public boundary and lifecycle.
- Add a README or owner only when contributors need a stable entrypoint.
- Register a new active owner in `nexus/docs/README.md` or the application documentation index.
- Put architecture, roadmap, research, proposal, and historical evidence in their existing physical domains.
- Do not create `.ai-context.md`, `README.AI.md`, or `ai-rules.md`.

### 5. Verify

```bash
bun install
bun run docs:check
bun --cwd nexuscheck:toolchain
bun run typecheck
bun run lint
bun run verify:q
bun run build
```

Run package-specific tests and production-artifact checks where applicable.

## Prohibited shortcuts

- Creating a package to avoid refactoring an existing owner.
- Copying an application module into `packages/` without a reusable contract.
- Adding deep cross-package imports instead of a public facade.
- Treating an arbitrary line limit as proof a split is needed.
- Scaffolding generated registry output by hand.
- Introducing another Bun version or lockfile.
- Creating an unindexed owner document.

## Completion evidence

- owner and dependency direction are explicit;
- package, tsconfig, scripts, and Bun 1.3.14 boundary match repository conventions;
- workspace install resolves consumers without an alternate lockfile;
- focused tests and applicable repository gates pass;
- documentation map and public API are updated only where needed;
- no duplicate registry, state owner, compatibility facade, or documentation owner was introduced.