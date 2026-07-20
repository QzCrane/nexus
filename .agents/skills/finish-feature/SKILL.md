---
name: finish-feature
description: 完成功能或修复时执行交付闭环：范围审计、聚焦测试、全量适用质量门、文档/隐私/发布投影同步，并按用户授权提交或推送。触发短语:"finish feature", "ship it", "end task", "完工", "交付"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14 and git 2.30+
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

- Re-read the user request, [`rules.md`](../../../rules.md), the domain owner, and the final diff.
- Separate requested changes from accidental cleanup.
- Confirm contracts, identities, lifecycle, errors, permissions, privacy, and public projections affected by the diff.
- Remove debug code, stale generated output, dead compatibility paths, and comments that no longer describe behavior.

### 2. Run focused evidence first

Run the smallest tests that directly exercise the changed behavior. Include browser/lifecycle cases when the change depends on Chrome, activation, navigation, service-worker restart, media, offscreen, permissions, or production artifacts.

A typecheck or build is not a substitute for behavior tests.

### 3. Run the applicable repository gates

From `nexus/`:

```bash
bun run typecheck
bun run lint
bun run verify:q
bun run build
```

Run `bun run verify:v`, application release checks, production-artifact inspection, Chrome tests, remote-site checks, or localization checks when the changed/release scope requires them.

Do not run every expensive command blindly for an isolated documentation-only change; do not omit a required gate because it is slow.

### 4. Reconcile documentation and release truth

- Update exactly one domain owner for changed normative behavior.
- Update README, roadmap, privacy, permission justification, store copy, or archive evidence only when their projection changed.
- Verify relative links and counts against executable owners.
- Do not update nonexistent `.ai-context.md`, `README.AI.md`, or `ai-rules.md` files.
- Run `bun run sync:skills` when a project skill changed and inspect the `AGENTS.md` index.

### 5. Review the final diff

Check for:

- duplicated authorities or writers;
- stale identity/ACK paths and missing disposers;
- unbounded retries, timers, queues, caches, or input;
- dependency, lockfile, permission, network, and external-ABI changes;
- unverifiable public claims;
- accidental secrets, personal data, generated artifacts, or unrelated files.

### 6. Commit and push only within authorization

Prepare a Conventional Commit that describes the actual closure. Commit or push only when the user or invoking workflow authorized that Git mutation. Never force-push a shared/release branch by default.

## Prohibited shortcuts

- Declaring completion from a green typecheck alone.
- Hiding a failing test by weakening the assertion or excluding the file.
- Adding a generic “docs updated” line without checking the actual owner.
- Committing unrelated workspace changes with the feature.
- Pushing first and treating CI as the initial test run.

## Completion evidence

- requested behavior is implemented and no known requested item remains;
- focused behavior tests pass;
- all applicable type, lint, architecture, build, browser, artifact, privacy, and release gates pass;
- final diff is scoped and reviewed;
- documentation and public projections match implementation;
- Git status and commit/push state are reported accurately.