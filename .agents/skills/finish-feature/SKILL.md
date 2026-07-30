---
name: finish-feature
description: 完成功能或修复时执行交付闭环：范围审计、聚焦测试、Bun 1.3.14 与文档/架构门禁、隐私和发布投影同步，并按用户授权提交或推送。触发短语:"finish feature", "ship it", "end task", "完工", "交付"。
license: Proprietary. See LICENSE.txt
compatibility: Requires Bun 1.3.14 and git 2.30+
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Edit Grep
---

# Finish feature

## Trigger

Use after implementation is complete and before claiming delivery.

## Process

### 1. Reconstruct the intended closure

- Re-read the user request, [`rules.md`](../../../rules.md), [`nexus/docs/README.md`](../../../nexus/docs/README.md), the domain owner, and final diff.
- Separate requested changes from accidental cleanup.
- Confirm contracts, identities, lifecycle, errors, permissions, privacy, public projections, and toolchain boundaries affected by the diff.
- Remove debug code, stale generated output, dead compatibility paths, and comments that no longer describe behavior.

### 2. Run focused evidence first

Run the smallest tests that directly exercise changed behavior. Include browser/lifecycle cases when the change depends on Chrome, activation, navigation, service-worker restart, media, offscreen, permissions, or production artifacts.

A typecheck or build is not a substitute for behavior tests.

### 3. Run applicable repository gates

From `nexus/`:

```bash
bun run docs:check
bun run check:toolchain
bun run typecheck
bun run lint
bun run verify:q
bun run build
```

Run `verify:v`, application release checks, production-artifact inspection, Chrome tests, remote-site checks, localization checks, or generated-registry checks when the scope requires them. Do not run every expensive command blindly for an isolated change; do not omit a required gate because it is slow.

Run the applicable repository gates as one stable-candidate batch before the first push. If that batch exposes a concrete cause, fix it, rerun the narrow failing evidence while iterating, then run one final applicable batch. Do not replay the entire matrix after every small edit.

`check:platform` validates Git-index bytes, modes, and attributes. When the candidate adds files, stage the exact intended candidate before its final platform run; a clean pass while those files are still untracked is not evidence for them.

### 4. Reconcile documentation and release truth

- Update exactly one normative owner for changed behavior.
- Keep architecture, roadmap, research, proposal, public projection, and archive roles separate.
- Update README, privacy, permission justification, store copy, or archive evidence only when their projection changed.
- Verify relative links and release-gated counts against executable owners.
- Use deprecated redirects only during an explicit migration window.
- Run `bun run sync:skills` when a project skill changed and inspect `AGENTS.md` consistency.

### 5. Review the final diff

Check for:

- duplicated authorities or writers;
- stale identity/ACK paths and missing disposers;
- unbounded retries, timers, queues, caches, or input;
- dependency, lockfile, Bun-version, permission, network, and external-ABI changes;
- unverifiable public claims;
- accidental secrets, personal data, generated artifacts, or unrelated files.

### 6. Commit and push only within authorization

Prepare a Conventional Commit describing the actual closure. Commit or push only when the user or invoking workflow authorized that mutation. Never force-push a shared or release branch by default.

Keep at most one unpushed candidate in each affected repository and amend it while it is still private when necessary. Verify private and generated/public repositories together, then push each authorized remote once. Merge and delete the short-lived task branch/worktree after the remote target is confirmed.

## Prohibited shortcuts

- Declaring completion from a green typecheck alone.
- Hiding a failing test by weakening an assertion or excluding a file.
- Adding a generic “docs updated” line without checking the owner graph.
- Introducing another Bun version or alternate package-manager lockfile.
- Committing unrelated workspace changes with the feature.
- Pushing first and treating CI as the initial test run.

## Completion evidence

- requested behavior is implemented and no known requested item remains;
- focused behavior tests pass;
- Bun 1.3.14, documentation, type, lint, architecture, build, browser, artifact, privacy, and release gates pass where applicable;
- final diff is scoped and reviewed;
- canonical docs and public projections match implementation;
- Git status and commit/push state are reported accurately.
