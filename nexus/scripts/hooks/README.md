---
type: explanation
status: stable
audience: contributor
owner: ai-tool-hooks
last_reviewed: 2026-11-02
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
    → _hook-helpers.ts
      → allow / block / report
```

Shared helpers own stdin parsing, path normalization, command extraction, protected-zone checks, debug tracing, exit semantics, and checkpoint formatting. Host wrappers should remain small and contain only host-specific payload adaptation.

## Hook inventory

| Hook | Phase | Purpose |
| --- | --- | --- |
| `ai-pre-write-guard.ts` | before supported write/edit actions | block writes to protected/generated zones |
| `ai-post-write-lint.ts` | after supported write/edit actions | run focused documentation, strict Biome, and AI-pitfall feedback without rewriting the written file |
| `ai-stop-checkpoint.ts` | turn stop | report working-tree and verification reminders |
| `codex-bash-guard.ts` | before supported shell actions | block commands targeting protected zones |
| `codex-stop-checkpoint.ts` | turn stop | reuse the shared checkpoint output |

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

It also rejects the invalid `bun --cwd <dir> run <script>` ordering in
Lefthook commands. Bun prints help and exits successfully for that form, which
would otherwise turn a required pre-push gate into a false green.

The pre-push commands are independent read-only gates and therefore run in
parallel. Skill-index validation uses `bun run sync:skills -- --check`; it
fails on drift without rewriting `AGENTS.md`, so it cannot race with the other
checks. The mutating `bun run sync:skills` remains a deliberate authoring or
post-merge action.

On Windows, a nested MSYS shell can fail before Lefthook launches its gates.
The pre-commit fallback calls `git-pre-commit.ts`, reads the staged index through
Git's NUL-delimited output, and reuses the existing repository-to-workspace path
projection. Root files such as `remote-site/dist/protocol.js` retain `../` rather
than becoming nonexistent workspace paths; spaces and newlines remain one process
argument. The fallback runs the same strict Biome and documentation owners as
Lefthook and propagates failures. It does not rewrite files or skip a failed gate.
The strict Biome runner passes its already validated, scope-filtered file set to
Biome itself, so an explicit generated path outside the workspace cannot be
processed in addition to the expected set. Generated Remote protocol integrity
continues to belong to the public-projection gate.
The admitted set runs in bounded argument batches to fit Windows process limits.
Each batch must prove its exact file count and zero diagnostics; all admitted
scripts still pass the silent-handler scan before the overall gate succeeds.

Do not hard-code the assertion count or runtime in this README; both change as coverage grows. The current test output is the source for those values.

## Debugging

Set `NEXUS_HOOK_DEBUG=1` for local diagnostic tracing:

```bash
NEXUS_HOOK_DEBUG=1 bun --cwd nexus scripts/hooks/ai-pre-write-guard.ts < payload.json
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
