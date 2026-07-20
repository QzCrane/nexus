---
name: typecheck
description: 运行全 workspace、SPECTRA 依赖闭包或单包 TypeScript 检查，并把类型错误追溯到契约与运行时边界。触发短语:"typecheck", "ts check", "类型检查", "ts 报错"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14 and the repository TypeScript version
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Grep
---

# Typecheck

## Trigger

Use after TypeScript/config/contract changes, when diagnosing compiler errors, and before merge/release.

## Commands

From `nexus/`:

```bash
# Entire workspace
bun run typecheck

# SPECTRA dependency closure
bun run typecheck:spectra

# One package/application when iterating
bun run --cwd apps/extension-spectra typecheck
bun run --cwd apps/extension-halo typecheck
```

Read the current package scripts when targeting another workspace. Do not assume every package exposes the same command.

## Diagnosis order

1. Read the first causal compiler error, not only the final cascade.
2. Identify the owning contract/type and its runtime boundary.
3. Check for duplicated DTOs, stale generated types, wrong dependency direction, or a mismatched discriminant.
4. Fix the model or validator before adding an assertion.
5. Re-run the focused package, then the affected dependency closure or full workspace.

TypeScript establishes compile-time relationships. It does not validate storage, message, network, browser, JSON, or third-party data at runtime.

## Assertions and suppressions

- Prefer type guards, runtime validators, derived types, and discriminated unions.
- An assertion is acceptable only after an explicit runtime boundary proves the shape and the reason is local and reviewable.
- `as any`, blanket `@ts-ignore`, and widening a public type to silence callers are prohibited shortcuts.
- `@ts-expect-error` belongs only in a test or compatibility case that asserts the expected compiler failure and explains the boundary.

## Prohibited shortcuts

- Editing generated declarations instead of the generator/source.
- Making required fields optional to avoid updating a lifecycle or protocol.
- Adding parallel interfaces in applications instead of using the contract owner.
- Assuming build success includes strict typecheck.
- Reporting “no any warnings” from `tsc`; compiler success does not prove the repository's semantic `any` policy.

## Completion evidence

- focused package typecheck passes;
- affected dependency closure/full workspace passes as applicable;
- no new unsafe assertion or suppression was introduced;
- runtime validation exists at untrusted boundaries;
- generated types are refreshed through their owner;
- the fix preserves the intended dependency and contract direction.