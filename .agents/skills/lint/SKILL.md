---
name: lint
description: 运行 NEXUS 的 Biome、workspace fallback、SPECTRA release 和 Markdown 结构检查，并区分检查与自动修复。触发短语:"lint", "biome", "代码风格", "文档检查"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read
---

# Lint

## Trigger

Use for code style, static lint, formatting, or documentation-structure checks.

## Process

### Repository lint

From `nexus/`:

```bash
bun run lint
```

This command is the script authority for the current lint set. It runs the configured Turbo workspace filters, workspace fallbacks, and SPECTRA release-surface lint. Do not copy a permanent package list into this skill.

### Focused workspace lint

Use the owning package script only when rapid feedback is useful, for example:

```bash
bun run --cwd apps/extension-spectra lint
```

A focused pass does not replace the applicable repository lint before merge or release.

### Documentation structure

For Markdown under the configured documentation roots:

```bash
bun scripts/lint-docs.mjs
```

The documentation linter checks the repository's current frontmatter and structural rules. It does not prove that links, dynamic facts, public claims, or technical semantics are correct; review those separately.

### Automatic fixes

Use Biome write mode only on the intended files, then inspect the diff. Do not run a broad rewrite across generated, vendored, archived, or unrelated files.

## Interpretation

A lint failure can indicate formatting, import order, unsupported syntax, an explicit lint rule, missing documentation frontmatter, or a repository fallback check. Read the actual diagnostic before changing code.

Do not claim that Biome alone detects every dead path, unsafe assertion, promise leak, architecture violation, browser lifecycle error, or public-copy mismatch. Those belong to typecheck, tests, architecture gates, and review.

## Prohibited shortcuts

- Adding a blanket suppression without documenting the exact false positive and boundary.
- Formatting unrelated files to hide the meaningful diff.
- Treating a clean lint run as behavior verification.
- Editing generated output rather than its source.
- Ignoring warnings that increased because the command still exited zero.

## Completion evidence

- focused lint passes during iteration;
- applicable repository lint passes;
- Markdown structure passes for changed active docs;
- suppressions are narrow and justified;
- the final diff contains no unrelated formatting churn or generated-file edits.