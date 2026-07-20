---
name: sync-nexus
description: 使用受审计的同步脚本生成 SPECTRA 或 HALO public 仓库候选：验证私库、保留目标 .git、过滤复制、强制 Bun 1.3.14、构建、审查单个生成提交，再按授权推送。触发短语:"sync nexus", "push to public", "同步开源", "sync spectra", "sync halo"。
license: Proprietary. See LICENSE.txt
compatibility: Requires Bun 1.3.14, git 2.30+, and a sibling public-repository checkout
metadata:
  category: release
  app: nexus
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Grep
---

# Sync NEXUS to a public repository

## Trigger

Use when generating the approved SPECTRA or HALO public repository from the private monorepo.

## Critical behavior

`nexus/scripts/sync-public.cjs` is destructive to the destination working tree: it removes everything except the destination's `.git` and `node_modules`, copies the filtered private workspace, projects the application README/privacy files, normalizes package metadata to `bun@1.3.14`, installs, builds, removes generated artifacts, and creates at most one generated commit.

It preserves the destination repository's existing Git history. It does **not** transplant the private repository's commit graph. It never pushes.

## Process

### 1. Select and inspect the target

- Choose exactly one target: `spectra` or `halo`.
- Confirm the sibling checkout is the intended public repository and its branch/remote are correct.
- Save or discard unrelated destination changes before running the destructive generator.
- Read the current configuration in `nexus/scripts/sync-public.cjs`; the script owns source paths, exclusions, copied entrypoints, artifact cleanup, and package rewriting.
- Verify the target application's public README and required privacy surface exist.

### 2. Validate the private source

From the repository root:

```bash
bun run docs:check
bun --cwd nexus run check:toolchain
bun run lint
bun run typecheck
bun run verify:v
bun run build
```

Add target-specific browser, UI, artifact, privacy, localization, and release checks. A successful destination build does not replace private-source verification.

### 3. Run the maintained generator

```bash
bun run sync-spectra
# or
bun run sync-halo
```

The script fails when the source workspace does not declare `packageManager: bun@1.3.14`, when the generated repository lacks `package.json`, when install/build fails, or when the final generated package manager drifts from Bun 1.3.14.

Do not manually copy around the generator. Fix source projections or exclusions as a reviewed code change.

### 4. Audit the generated repository

Before push, inspect:

- `git status`, the single generated commit when changes exist, and the complete diff against the destination's previous commit;
- public README, privacy policy, license, package metadata, scripts, and lockfile;
- exact `packageManager: bun@1.3.14` and successful clean install/build;
- absence of private docs, secrets, internal assets, tests, build artifacts, local agent configuration, and excluded applications;
- whether destination cleanup removed a public file still required by users or release automation.

The generated commit is not reviewed merely because install/build passed.

### 5. Push only with authorization

From the destination repository after review:

```bash
git push origin <approved-branch>
```

Do not assume `main`, force-push, tag, release, or store publication permission.

## Prohibited shortcuts

- Running against an unverified path or valuable uncommitted destination tree.
- Claiming private Git history was preserved in the public repository.
- Editing generated output to conceal a wrong source/exclusion rule.
- Pushing a package whose Bun version, privacy, permissions, README, or lockfile differs from the audited source.
- Weakening exclusions without reviewing information-disclosure consequences.
- Treating generator success as authorization to push.

## Completion evidence

- target, destination path, branch, and remote are recorded;
- private-source documentation, toolchain, architecture, test, and build gates pass;
- generator exits successfully under Bun 1.3.14;
- generated diff, single commit, exclusions, metadata, lockfile, install, and build are inspected;
- no private/internal data is present;
- push status is reported separately and performed only when authorized.