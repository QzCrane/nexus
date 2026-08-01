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

`nexus/scripts/sync-public.ts` is destructive to the destination working tree: it removes everything except the destination's `.git` and `node_modules`, batch-reads only committed files from the private source `HEAD`, projects the application README/privacy files, rejects relative Markdown links whose targets are absent from or escape the generated repository, applies explicit root/application script and build-module allowlists, normalizes package metadata to `bun@1.3.14`, installs, runs the retained public `lint`, `typecheck`, and `build` commands, removes generated outputs together with their incremental `.tsbuildinfo` state, and creates at most one generated commit. Ignored, untracked, staged, and unstaged files are never public inputs. Repository-root automation and application test/release scripts are excluded while application-local build modules remain available to the generated application.

The validation starts from an artifact-clean projection and uses an ignored persistent Turbo cache under `node_modules`; this preserves correctness while avoiding a cold build on every synchronization. A failed gate cannot create a candidate commit. The script preserves the destination repository's existing Git history. It does **not** transplant the private repository's commit graph. It never pushes.

The destination defaults to `../../${target}-public` relative to the script. Override with the `SYNC_PUBLIC_DEST` environment variable for CI or non-standard checkout layouts. The `.agents`, `.codex`, `.github`, and `.gitnexus` directories are always excluded; the public repository never receives internal tooling or version-management state.

## Process

### 1. Select and inspect the target

- Choose exactly one target: `spectra` or `halo`.
- Confirm the sibling checkout is the intended public repository and its branch/remote are correct.
- Save or discard unrelated destination changes before running the destructive generator.
- Read the current configuration in `nexus/scripts/sync-public.ts`; the script owns source paths, exclusions, copied entrypoints, artifact cleanup, and package rewriting.
- Verify the target application's public README and required privacy surface exist.

### 2. Validate the private source

From the repository root:

```bash
bun run docs:check
bun --cwd nexus check:toolchain
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

The script fails when the source workspace does not declare `packageManager: bun@1.3.14`, when the generated repository lacks `package.json`, when install/lint/typecheck/build fails, or when the final generated package manager drifts from Bun 1.3.14. It prints stage timings and a projected-file count instead of one log line per copied file.

If and only if the destination is clean and exactly `0 behind / 1 ahead` of its configured upstream, amend the single unpushed generated candidate instead of creating another commit:

```bash
bun run sync-spectra -- --amend
```

Normal synchronization requires `0 behind / 0 ahead`. `--amend` refuses missing upstreams, diverged branches, and any state other than the one unpushed candidate.

Do not manually copy around the generator. Fix source projections or exclusions as a reviewed code change.

Do not push either repository while discovering projection failures. Keep one unpushed private candidate, amend it when source changes, use `--amend` for the one unpushed public candidate when applicable, and push each authorized remote once only after the private and public closure is green.

### 4. Audit the generated repository

Before push, inspect:

- `git status`, the single generated commit when changes exist, and the complete diff against the destination's previous commit;
- public README, privacy policy, license, package metadata, scripts, and lockfile;
- exact `packageManager: bun@1.3.14` and successful clean install/lint/typecheck/build;
- retained public `lint`, `typecheck`, and `build` commands and their generator-recorded results from the artifact-clean generated state;
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
