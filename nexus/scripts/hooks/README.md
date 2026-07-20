---
type: explanation
status: stable
audience: contributor
last_reviewed: 2026-07-20
---

# AI-tool hooks

The hook layer gives supported coding tools early feedback before Git and CI run the repository-wide gates. It is defense in depth, not the authority for prohibited behavior.

- repository constraints: [`../../../rules.md`](../../../rules.md)
- agent entrypoint: [`../../../AGENTS.md`](../../../AGENTS.md)
- process rule: [EPR-029](../../docs/principles/04-process-and-quality.md#epr-029-质量门硬化到-gitciai-钩子文档风格靠-lint-守)
- Git gates: [`../../../lefthook.yml`](../../../lefthook.yml)

## Architecture

```text
host configuration
  → thin host-specific hook
    → _hook-helpers.mjs
      → allow / block / report
```

Shared helpers own stdin parsing, path normalization, command extraction, protected-zone checks, debug tracing, exit semantics, and checkpoint formatting. Host wrappers should remain small and contain only host-specific payload adaptation.

## Hook inventory

| Hook | Phase | Purpose |
| --- | --- | --- |
| `ai-pre-write-guard.mjs` | before supported write/edit actions | block writes to protected/generated zones |
| `ai-post-write-lint.mjs` | after supported write/edit actions | run focused documentation/format feedback on the written file |
| `ai-stop-checkpoint.mjs` | turn stop | report working-tree and verification reminders |
| `codex-bash-guard.mjs` | before supported shell actions | block commands targeting protected zones |
| `codex-stop-checkpoint.mjs` | turn stop | reuse the shared checkpoint output |

Actual host capabilities are version-dependent. Revalidate the current official host documentation before adding a matcher or claiming that direct writes, shell commands, Windows, or another platform are intercepted.

Hooks are not a security boundary. A tool can be unsupported, disabled, misconfigured, or able to write through an unhooked path. Lefthook and CI must catch the same repository violations later.

## Tests

From the repository root:

```bash
bun run hooks:test
```

The maintained suite covers:

1. pure helper behavior;
2. hook entrypoint smoke cases with synthetic payloads;
3. host-config command resolution and referenced-script existence;
4. shared checkpoint parity;
5. protected and allowed path cases.

Do not hard-code the assertion count or runtime in this README; both change as coverage grows. The current test output is the source for those values.

## Debugging

Set `NEXUS_HOOK_DEBUG=1` for local diagnostic tracing:

```bash
NEXUS_HOOK_DEBUG=1 bun --cwd nexus scripts/hooks/ai-pre-write-guard.mjs < payload.json
```

Debug output may include the synthetic or real host payload. Do not enable it in a context that can expose secrets or private source content to an untrusted log sink.

## Adding or changing a hook

1. define the exact host, phase, payload, and failure semantics;
2. reuse `runHook(...)` and shared helpers;
3. guard executable entry with `import.meta.main` so tests can import the module;
4. register the command in the supported host config;
5. add helper and smoke coverage, including malformed input and allowed paths;
6. run `bun run hooks:test` and the applicable Git/CI gates;
7. update this inventory only after the implementation lands.

A hook must fail predictably. A parsing error cannot accidentally turn a protected operation into an unconditional allow or leave the invoking tool waiting indefinitely.