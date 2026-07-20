---
name: update-context
description: 将代码或产品变更同步到唯一 owner、入口、计划、隐私/商店投影和历史证据，并修复链接与漂移；不维护已删除的 AI 专用文档层。触发短语:"update context", "sync docs", "更新文档", "文档同步"。
license: Proprietary. See LICENSE.txt
compatibility: Requires repository read/write access
metadata:
  category: maintenance
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Read Edit Grep
---

# Update documentation context

## Trigger

Use after a behavior, architecture, permission, lifecycle, public claim, release process, or documentation owner changes.

## Principle

Documentation follows ownership, not a fixed number of layers. Update only the documents whose semantic projection changed. Do not create or maintain `.ai-context.md`, `README.AI.md`, `docs/ai-rules.md`, or a user-home `nexus.md`; they are not current repository authorities.

The canonical map is [`nexus/docs/documentation-index.md`](../../../nexus/docs/documentation-index.md).

## Process

### 1. Classify the change

Determine whether the change affects:

- repository rules or contributor workflow;
- a domain contract/architecture owner;
- a roadmap or unresolved proposal;
- user/developer entrypoints;
- permissions, privacy, remote/network behavior, or store copy;
- a dated release/regression/audit record;
- an agent skill or generated index.

A code change may affect none, one, or several projections. Do not update every Markdown file mechanically.

### 2. Update the normative owner once

- Put current behavior in the one owner listed by the documentation map.
- Link from neighboring documents instead of copying the complete rule/matrix.
- Update counts only when the executable registry/contract/gate changed.
- Distinguish desired, actual, proposed, historical, and public behavior.
- Add the corresponding contract/test/release-gate evidence in the same closure.

### 3. Update planning only when sequencing changed

Roadmaps describe future or unresolved work. Do not mark a feature complete from a commit title or checkbox; require implementation and verification evidence. Add `last_reviewed` or an evidence date when the current status depends on time.

### 4. Reconcile public projections

When permissions, data flow, network providers, transmitted fields, retention, or user-visible capability changes, compare:

- product README;
- privacy policy;
- permission/data-use justification;
- every store locale;
- remote-site disclosure and release gate;
- actual manifest and production artifact.

Public copy cannot be broader than verified behavior. Translate one capability set across locales rather than maintaining independent promises.

### 5. Preserve historical evidence

Create a dated report for a release, regression recovery, benchmark, or audit when its exact commit/results matter. Mark it archived and link current owners. Do not rewrite old measurements into present-tense claims.

### 6. Update skills correctly

Edit `.agents/skills/<name>/SKILL.md`, then run `bun run sync:skills` so the `AGENTS.md` index is refreshed. Keep `CLAUDE.md` identical/hardlinked through the maintained post-analyze flow.

### 7. Validate structure and links

- run the documentation linter for changed active docs;
- verify relative paths from the file's own directory;
- search for renamed paths, removed anchors, old counts, stale versions, and conflicting phrases;
- check frontmatter type/status/audience where required;
- inspect the final Markdown rendering for malformed lists, tables, code fences, and headings.

## Prohibited shortcuts

- Copying one rule into multiple owners “for convenience.”
- Updating a roadmap instead of the implemented contract.
- Replacing evidence with a vague “docs synchronized” sentence.
- Keeping a broken link because the target existed historically.
- Treating a research/market number as current without revalidation.
- Editing only the English store listing after a capability or limitation changes.
- Adding a document without placing it in the authority map.

## Completion evidence

- changed semantics appear in exactly one normative owner;
- all affected projections agree with that owner and implementation;
- plans remain proposals, archives remain historical, and public copy remains verified;
- no old path/count/version/claim survives in active docs;
- documentation lint and manual link/render review pass;
- skill index is regenerated when applicable;
- final diff contains no unrelated documentation churn.