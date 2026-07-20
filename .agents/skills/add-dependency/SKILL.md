---
name: add-dependency
description: 引入或升级依赖的标准流程：查重、当前版本/许可/CVE 核验、最窄 workspace 安装、验证与边界记录。触发短语:"add dependency", "install package", "upgrade package", "加依赖"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14 and git 2.30+
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Edit Grep WebSearch
---

# Add dependency

## Trigger

Use this skill when adding, replacing, or materially upgrading a package.

## Process

### 1. Identify the owning workspace

- Read [`rules.md`](../../../rules.md), the owning package manifest, and the domain owner document.
- Search all workspace `package.json` files and imports for an existing equivalent capability.
- Decide whether the dependency belongs to one application/package or is genuinely shared.
- Prefer platform APIs or an existing dependency when they provide the same complete behavior with lower lifecycle cost.

### 2. Verify the external fact

Use current primary sources to check:

- official package identity and stable version;
- license and redistribution obligations;
- maintenance status, deprecations, and known advisories;
- Bun, browser, worker, ESM/CJS, and TypeScript compatibility;
- transitive dependencies, bundle/asset impact, network behavior, and external ABI.

Do not install a remembered version or rely only on a registry/search summary.

### 3. Install at the narrowest boundary

Run from `nexus/`:

```bash
# Owning workspace
bun add <package>@<version> --cwd apps/<app>
# or
bun add <package>@<version> --cwd packages/<package>

# Root development tooling only when the whole workspace owns it
bun add -d <package>@<version>
```

Use Bun for the lockfile. Do not create another package-manager lockfile.

### 4. Integrate deliberately

- Import through the owning module's public boundary.
- Add runtime validation around untrusted package output where applicable.
- Isolate browser globals, workers, network destinations, vendored assets, or property-mangling boundaries.
- Update the domain owner/README only when the dependency changes architecture, permissions, privacy, build output, or contributor workflow.
- Do not maintain a manual repository-wide dependency table that can drift from manifests and `bun.lock`.

### 5. Verify

Run the focused package checks, then the applicable repository gate:

```bash
bun install
bun run typecheck
bun run lint
bun run verify:q
```

Also run affected tests and a production build when the dependency enters runtime output.

## Prohibited shortcuts

- Installing first and justifying later.
- Adding an equivalent library because its API is more familiar.
- Placing an application-only package at workspace root.
- Ignoring peer-dependency, license, advisory, or bundle warnings.
- Using `@types/*` without confirming the package lacks correct bundled types.

## Completion evidence

- manifest and `bun.lock` contain the intended package/version;
- no unintended lockfile exists;
- the selected workspace is the narrowest owner;
- current version/license/security evidence is recorded in the PR or commit context;
- focused tests, typecheck, lint, architecture verification, and production build pass where applicable;
- documentation, permission, privacy, or artifact boundaries are updated when changed.