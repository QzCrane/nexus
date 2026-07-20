---
name: verify
description: 运行 NEXUS 架构验证器的快速、默认或详细模式，解释具体规则失败，并补足不在该脚本内的测试/构建/文档检查。触发短语:"verify", "check architecture", "架构校验", "verify 一下"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Grep
---

# Verify architecture

## Trigger

Use after cross-module, contract, registry, permission, runtime, release-surface, or architectural changes, and before merge/release.

## Commands

From `nexus/`:

```bash
# Fast feedback
bun run verify:q

# Default verifier
bun run verify

# Detailed output for review/release
bun run verify:v
```

`nexus/scripts/verify-architecture.js` is the executable owner of the current rule set and mode behavior. Read its output and source when the skill text and script differ.

## Failure handling

1. Identify the exact rule ID/check and files involved.
2. Determine the violated owner or dependency/lifecycle boundary.
3. Fix the source model rather than adding an exclusion or duplicate compatibility path.
4. Run the focused check again.
5. Run the detailed/applicable full gate before delivery.

A verifier failure can expose stale generated output, wrong dependency direction, duplicate definitions, forbidden paths, contract drift, release-surface mismatch, or another repository-specific invariant. Do not reduce it to “formatting” without reading the diagnostic.

## Scope boundary

Architecture verification does not automatically prove all of the following unless the current script explicitly runs them:

- TypeScript across every workspace;
- Biome and documentation lint;
- unit, Chrome, SidePanel, Playwright, remote-live, or production-artifact tests;
- privacy/store translation accuracy;
- current external package, API, policy, or provider facts;
- absence of runtime races or resource leaks.

Run the missing gates required by the change.

## Changing a verifier rule

A rule change is a behavioral code change. It requires:

- the owner principle/contract and failure class;
- positive and negative fixtures/tests;
- analysis of existing violations and migration impact;
- no silent grandfathering that lets new violations through;
- updated documentation when the enforced architecture changed.

Do not weaken a rule solely because current code fails it.

## Prohibited shortcuts

- Skipping verification because only one file changed.
- Adding path/name exceptions without proving a different legitimate invariant.
- Treating warning-count stability as correctness.
- Claiming a green verifier replaces tests or browser evidence.
- Editing generated output to satisfy the check temporarily.
- Running only quiet mode before a release that requires detailed evidence.

## Completion evidence

- selected mode matches the task stage;
- every failure is resolved or explicitly reported as a blocker;
- detailed/applicable verification passes at the final commit;
- required type, lint, test, build, browser, artifact, documentation, and privacy gates also pass;
- verifier-rule changes include tests and owner documentation.