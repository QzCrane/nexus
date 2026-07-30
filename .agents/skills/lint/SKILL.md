---
name: lint
description: 运行 NEXUS 的 Biome、workspace fallback、SPECTRA release、Markdown 权威图和 Bun 1.3.14 检查，并区分检查与自动修复。触发短语:"lint", "biome", "代码风格", "文档检查"。
license: Proprietary. See LICENSE.txt
compatibility: Requires Bun 1.3.14
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read
---

# Lint

## Trigger

Use for code style, static lint, formatting, documentation architecture, or toolchain-drift checks.

## Process

### Repository code lint

From `nexus/`:

```bash
bun run lint
```

This command is the script authority for the current code-lint set. It dynamically verifies that every Turbo workspace sends its complete package root to the strict runner, runs all workspace tasks without a static filter list, and checks configuration, hooks, scripts, and remote-site surfaces outside those workspaces.

Workspace lint tasks use `scripts/run-strict-biome.mjs`. The runner independently inventories every supported file contributed by every declared target and requires Biome's processed-file count to match exactly. Errors, warnings, infos, skipped files, omitted diagnostics, empty targets, missing targets, overlapping targets, duplicate targets, and lexical or realpath escapes all fail. It parses eligible JavaScript/TypeScript sources under the same inventory and rejects empty or no-op `catch` bodies, empty Promise `.catch(...)` callbacks, and empty second-argument rejection handlers passed to `.then(...)`, including comment-only bodies. The repository's error-handling contract therefore cannot be bypassed by Biome's comment exception or by switching to an equally silent Promise form. Historical diagnostic baselines, mutable VCS-ignore scope, and package-specific rule overrides are not acceptable substitutes for a clean owner.

The repository uses Biome's complete recommended preset without global rule-off overrides. A genuine compatibility exception belongs at the narrow checked boundary with an exact reason; it does not justify disabling the rule for unrelated packages.

`lint:workspace-coverage` runs the path-boundary and strict-report contract tests before discovery. The staged-file hook and generated HALO/SPECTRA public candidates consume the same strict runner, and pre-push runs the complete repository lint owner. Do not reintroduce a direct truncated `biome check` command at those projections.

### Documentation architecture

From the repository root or `nexus/`:

```bash
bun run docs:check
```

The documentation gate checks canonical entrypoints, frontmatter, one-H1 structure, exact-case local links, deprecated redirects, byte-identical generated compatibility mirrors, stable-owner uniqueness, and reachability from documentation roots. It does not prove that dynamic public facts are current; those still require primary-source revalidation.

### Toolchain drift

From the repository root:

```bash
bun --cwd nexuscheck:toolchain
```

This requires runtime Bun 1.3.14, matching root/workspace package metadata, pinned Biome/Turbo versions, and no recognized stale Bun-version reference in repository text or configuration.

### Focused workspace lint

Use the owning package script for rapid feedback, for example from `nexus/`:

```bash
bun run --cwd apps/extension-spectra lint
```

A focused pass does not replace applicable repository gates before merge or release.

### Automatic fixes

Use Biome write mode only on intended files, then inspect the diff. Do not broadly rewrite generated, vendored, archived, compatibility-mirror, or unrelated files. Edit the canonical owner of a generated compatibility mirror, then refresh the mirror through the maintained migration mechanism.

## Interpretation

A failure may indicate formatting, import order, unsupported syntax, missing documentation ownership, dead or mis-cased local links, invalid redirects, compatibility-mirror drift, an orphan owner, a duplicate stable owner, a toolchain mismatch, or a repository fallback rule. Read the exact diagnostic before changing code.

Biome alone does not prove behavior, browser lifecycle, privacy truth, architecture correctness, or production-artifact integrity.

## Prohibited shortcuts

- Adding a blanket suppression without documenting the exact false positive and boundary.
- Adding or refreshing a diagnostic baseline to grandfather known findings.
- Formatting unrelated files to hide the meaningful diff.
- Treating clean lint or docs checks as behavior verification.
- Editing generated output or a compatibility mirror rather than its canonical source.
- Ignoring warnings or infrastructure failures because a command did not run.
- Weakening the documentation graph to make an orphan, duplicate owner, or mirror drift disappear.

## Completion evidence

- focused lint passes during iteration;
- repository code lint passes where applicable;
- every applicable Biome surface reports zero errors, warnings, and infos;
- `docs:check` passes for the final tree;
- Bun 1.3.14 toolchain check passes;
- suppressions are narrow and justified;
- final diff contains no unrelated formatting churn or unauthorized generated-file edits.
