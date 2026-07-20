---
name: update-context
description: 将代码或产品变更同步到唯一 owner、入口、路线图、隐私/商店投影和历史证据，并修复链接与漂移。触发短语:"update context", "sync docs", "更新文档", "文档同步"。
license: Proprietary. See LICENSE.txt
compatibility: Requires Bun 1.3.14 and repository read/write access
metadata:
  category: maintenance
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Edit Grep
---

# Update documentation context

## Trigger

Use after a behavior, architecture, permission, lifecycle, public claim, release process, toolchain, or documentation owner changes.

## Principle

Documentation follows authority and lifecycle, not a fixed number of AI-specific layers. Do not create `.ai-context.md`, `README.AI.md`, `docs/ai-rules.md`, or a user-home `nexus.md`; they are not current repository authorities.

The canonical map is [`nexus/docs/README.md`](../../../nexus/docs/README.md).

## Process

### 1. Classify the change

Determine whether the change affects:

- repository rules or contributor workflow;
- a domain contract/architecture owner;
- a roadmap or unresolved proposal;
- research or dated evidence;
- user/developer entrypoints;
- permissions, privacy, remote/network behavior, or store copy;
- an archived release/regression/audit record;
- an agent skill or generated index.

A change may affect none, one, or several projections. Do not update every Markdown file mechanically.

### 2. Update the normative owner once

- Put current behavior in the owner listed by the documentation map.
- Link from neighboring documents instead of copying the complete rule or matrix.
- Update counts only when the executable registry, contract, and gate changed.
- Distinguish desired, actual, proposed, researched, historical, and public behavior.
- Add contract, implementation, test, and release evidence in the same closure.

### 3. Keep planning and research separate

Roadmaps describe sequencing; proposals describe unresolved design; research records dated evidence. None proves implementation. Add `last_reviewed`, evidence dates, and revalidation triggers when time-sensitive facts drive a decision.

### 4. Reconcile public projections

When permissions, data flow, providers, transmitted fields, retention, or user-visible capability changes, compare:

- product README;
- privacy policy;
- permission/data-use justification;
- every store locale;
- remote-site disclosure and release gate;
- actual manifest and production artifact.

Public copy cannot be broader than verified behavior. Translate one capability set across locales rather than maintaining independent promises.

### 5. Move documents as a migration

When reorganizing paths:

- create the canonical destination and index it;
- replace the old path with a short `deprecated` redirect containing `redirect_to` and `remove_after`;
- update executable consumers and high-value inbound links to the canonical path;
- keep aliases non-normative and remove them after the announced window;
- never copy a current owner into two maintained files.

### 6. Preserve historical evidence

Create a dated report when an exact commit, benchmark, regression, or release result matters. Mark it archived and link current owners. Do not rewrite old measurements into present-tense claims.

### 7. Update skills correctly

Edit `.agents/skills/<name>/SKILL.md`, then run `bun run sync:skills` so `AGENTS.md` is regenerated. Keep `CLAUDE.md` identical/hardlinked through the maintained post-analyze flow.

### 8. Validate

```bash
bun run docs:check
bun --cwd nexus run check:toolchain
```

Also:

- verify relative paths from each file's own directory;
- search for renamed paths, stale anchors, counts, versions, and conflicting phrases;
- inspect Markdown rendering;
- run affected tests and release gates when docs are executable mirrors.

## Prohibited shortcuts

- Copying one rule into multiple owners “for convenience.”
- Updating a roadmap instead of the implemented contract.
- Keeping a dead link because the target existed historically.
- Treating market data as current without revalidation.
- Editing only one store locale after a capability or limitation changes.
- Moving a file without redirect, consumer migration, and link validation.
- Claiming docs are synchronized before `docs:check` passes.

## Completion evidence

- changed semantics appear in exactly one normative owner;
- all affected projections agree with implementation;
- plans remain plans, proposals remain proposals, research remains dated, and archives remain historical;
- no stale path, count, version, or public claim survives in active docs;
- documentation and toolchain gates pass;
- skill index is regenerated when applicable;
- final diff contains no unrelated documentation churn.