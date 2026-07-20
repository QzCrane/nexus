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

This command is the script authority for the current code-lint set. It runs configured Turbo filters, workspace fallbacks, and SPECTRA release-surface lint. Do not copy a permanent package list into this skill.

### Documentation architecture

From the repository root or `nexus/` as shown:

```bash
bun run docs:check
# equivalent inside nexus/
bun run docs:check
```

The documentation gate checks canonical entrypoints, frontmatter, one-H1 structure, local links, registered migration symlinks, deprecated redirects, and reachability from documentation roots. It does not prove that dynamic public facts are current; those still require source revalidation.

### Toolchain drift

```bash
bun --cwd nexus run check:toolchain
```

This requires runtime Bun 1.3.14, matching root/workspace package metadata, pinned Biome/Turbo versions, and no recognized stale Bun-version reference in repository text/configuration.

### Focused workspace lint

Use the owning package script for rapid feedback, for example from `nexus/`:

```bash
bun run --cwd apps/extension-spectra lint
```

A focused pass does not replace applicable repository gates before merge or release.

### Automatic fixes

Use Biome write mode only on intended files, then inspect the diff. Do not broadly rewrite generated, vendored, archived, or unrelated files.

## Interpretation

A failure may indicate formatting, import order, unsupported syntax, missing documentation ownership, dead local links, invalid redirects, an orphan owner, a toolchain mismatch, or a repository fallback rule. Read the exact diagnostic before changing code.

Biome alone does not prove behavior, browser lifecycle, privacy truth, architecture correctness, or production-artifact integrity.

## Prohibited shortcuts

- Adding a blanket suppression without documenting the exact false positive and boundary.
- Formatting unrelated files to hide the meaningful diff.
- Treating clean lint or docs checks as behavior verification.
- Editing generated output rather than its source.
- Ignoring warnings or infrastructure failures because a command did not run.
- Weakening the documentation graph to make an orphan or duplicate owner disappear.

## Completion evidence

- focused lint passes during iteration;
- repository code lint passes where applicable;
- `docs:check` passes for the final tree;
- Bun 1.3.14 toolchain check passes;
- suppressions are narrow and justified;
- final diff contains no unrelated formatting churn or generated-file edits.