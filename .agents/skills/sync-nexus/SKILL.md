---
name: sync-nexus
description: 使用受审计的同步脚本生成 SPECTRA 或 HALO public 仓库候选：先验证、清空目标工作树但保留其 .git、复制/排除、构建、审查生成提交，再按授权推送。触发短语:"sync nexus", "push to public", "同步开源", "sync spectra", "sync halo"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, git 2.30+, and a sibling public-repository checkout
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

`nexus/scripts/sync-public.cjs` is destructive to the destination working tree: it removes everything except the destination's `.git` and `node_modules`, copies the filtered private workspace, rewrites selected root files, runs install/build, and creates one or more commits.

It preserves the destination repository's existing Git history. It does **not** transplant the private repository's commit graph.

The script does not push. Push remains a separate authorized action.

## Process

### 1. Select and inspect the target

- Choose exactly one target: `spectra` or `halo`.
- Confirm the sibling checkout is the intended public repository and its current branch/remote are correct.
- Save or discard unrelated destination changes before running the script.
- Read the current `CONFIG` in `nexus/scripts/sync-public.cjs`; the script, not this skill, owns source paths, exclusions, copied README/privacy files, artifact cleanup, and package rewriting.
- Verify that required public README/privacy files actually exist for the selected application.

### 2. Validate the private source first

From `nexus/`, run the applicable type, lint, architecture, tests, build, privacy, and release gates. The sync script currently performs destination install/build, but that does not replace private-source verification.

At minimum:

```bash
bun run lint
bun run typecheck
bun run verify:v
bun run build
```

Add SPECTRA or HALO release-specific checks for the target.

### 3. Run the maintained sync

```bash
bun run sync-spectra
# or
bun run sync-halo
```

Do not manually copy files around the script. If an exclusion or projection is wrong, fix and test the sync configuration as a deliberate code change.

### 4. Audit the generated repository

Before push, inspect:

- `git status`, generated commits, and complete diff against the destination's previous commit;
- public README, privacy policy, license, package metadata, toolchain version, scripts, and lockfile;
- absence of private docs, secrets, internal assets, tests, build artifacts, local agent configuration, and excluded applications;
- successful clean install and build in the generated repository;
- whether destination cleanup removed a file that public users still require.

The current sync script rewrites package metadata. Compare every rewritten value with the source toolchain and release policy; a stale hard-coded version blocks push.

### 5. Push only with authorization

Run from the destination repository after the generated diff and commit history are approved:

```bash
git push origin <approved-branch>
```

Do not assume `main`, force-push, tag, release, or publish a store artifact unless those actions were separately authorized.

## Prohibited shortcuts

- Running against an unverified path or a destination with valuable uncommitted files.
- Claiming that the script preserves private Git history.
- Treating the generated commit as reviewed because the destination build passed.
- Editing the destination to hide a wrong source/exclusion rule instead of fixing the generator.
- Pushing a generated package with a mismatched toolchain, privacy policy, permission set, or README.
- Temporarily weakening exclusions without reviewing information-disclosure consequences.

## Completion evidence

- selected target and destination path/remote are recorded;
- private-source release gates pass;
- sync script exits successfully;
- generated repository diff, commits, exclusions, metadata, lockfile, install, and build are inspected;
- no private/internal data is present;
- push status is reported separately and performed only when authorized.