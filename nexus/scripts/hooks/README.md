---
type: explanation
status: stable
audience: contributor
---

# AI-Tool Hooks

The hook layer is the **last line of defense** in the NEXUS quality-gate
chain. The floor is [AGENTS.md](../../../AGENTS.md) (rules), the ceiling is
[Lefthook](../../../lefthook.yml) (Git), and the AI-tool hooks sit in
between — they let the agent see a problem *before* the file is written or
the bash command is run, instead of waiting for the next `git commit`.

The normative rule is **EPR-029**
([principles/04-process-and-quality.md](../../docs/principles/04-process-and-quality.md)):
硬化质量门到 Git/CI/AI 钩子. This README explains *how the layer works*; for
*what* is forbidden, read the rule.

## Architecture

```
.claude/settings.json   .codex/hooks.json           ← host config (where to find the script)
        │                     │
        ▼                     ▼
ai-pre-write-guard      codex-bash-guard             ← entry points (one per host/tool)
ai-post-write-lint     codex-stop-checkpoint
ai-stop-checkpoint
        │                     │
        └──────────┬──────────┘
                   ▼
            _hook-helpers.mjs                      ← shared library
```

Every hook script is a thin wrapper around a shared helper. The helper
owns the boring stuff — stdin parsing, path normalization, exit-code
handling, debug tracing — so the per-hook logic stays short and easy
to audit.

### Hook inventory

| Hook | Host | Phase | Tool matcher | Effect |
|---|---|---|---|---|
| `ai-pre-write-guard.mjs` | Claude Code / Antigravity | PreToolUse | `Write\|Edit\|MultiEdit` | Block writes to forbidden zones (exit 2) |
| `ai-post-write-lint.mjs` | Claude Code / Antigravity | PostToolUse | `Write\|Edit\|MultiEdit` | Run `lint-docs` + `biome format` on the just-written file. Informational. |
| `ai-stop-checkpoint.mjs` | Claude Code / Antigravity | Stop | `*` | Print a working-tree reminder at turn end |
| `codex-bash-guard.mjs` | Codex CLI | PreToolUse | `Bash` | Block bash commands targeting protected files (exit 2) |
| `codex-stop-checkpoint.mjs` | Codex CLI | Stop | `*` | Same reminder as `ai-stop-checkpoint`, branded for Codex |

The two `*-stop-checkpoint` hooks share a single `formatCheckpointMessage()`
helper, so the reminder text stays in lockstep across Claude Code and Codex.

### Why Codex has fewer hooks

Codex CLI's hook support is **experimental** (v0.114+, March 2026) and
only intercepts the `Bash` tool — direct file writes via Codex's own
`Write`/`Edit` tools are NOT hookable. On Windows, Codex hooks are
unavailable entirely. The gap is covered by the layered safety net:

1. **AGENTS.md** — Codex reads project rules and is expected to honor them
2. **Lefthook `pre-commit`** — runs `lint-docs` + `biome check` on staged files
3. **Lefthook `pre-push`** — runs `verify:q` + `sync:skills` + `hooks:test`

So even if a Codex bash command bypasses the guard, the next `git push`
still catches the regression.

## Running tests

```bash
bun run hooks:test                    # full suite (101 assertions, ~1s)
bun --cwd nexus scripts/hooks/test.mjs
```

The suite has three layers:

- **A. Helper unit tests** — pure functions, no spawning. Catches logic
  bugs in `parsePayload`, `extractWriteTargets`, `extractBashCommand`,
  `relPath`, `WRITE_TOOLS`, `formatBlockMessage`, `formatCheckpointMessage`,
  `splitCommands`, `frontmatterProblem`.
- **B. Hook smoke tests** — spawn each hook with a synthetic stdin
  payload and assert the exit code (and optionally the stdout text).
  Data-driven: adding a test means adding one object to `cases[]`.
- **C. Config validator** — parse `.claude/settings.json` and
  `.codex/hooks.json`, extract every `command`, resolve the script
  path (honoring `--cwd <dir>`), and assert the file exists.

`hooks:test` runs as a Lefthook `pre-push` gate, so a broken refactor
cannot leave the repo.

## Debugging

Every hook respects `NEXUS_HOOK_DEBUG=1`. With the flag set, the
helper tees stdin chunks to stderr and logs the parsed payload plus
the decision flow:

```bash
NEXUS_HOOK_DEBUG=1 bun --cwd nexus scripts/hooks/ai-pre-write-guard.mjs < payload.json
```

Output looks like:

```
[hook-debug] stdin chunk (87 bytes):
{"tool_name":"Write","tool_input":{...}}
[hook-debug] stdin total 87 bytes
[ai-pre-write-guard] parsed payload: {"tool_name":"Write",...}
[ai-pre-write-guard] handler returned without exit; allowing
```

Zero-cost when the flag is unset. The env var is intentionally not
declared in `turbo.json` because it is debug-only and never part of
any cached task output.

## Adding a new hook

1. Create `nexus/scripts/hooks/<name>.mjs`. Use `import.meta.main`
   to guard the `runHook(...)` call so the script can be imported
   by the test runner without auto-executing:

   ```javascript
   import { runHook } from './_hook-helpers.mjs';

   async function main(payload) {
     // ... hook logic
   }

   if (import.meta.main) {
     await runHook('<name>', main);
   }
   ```

2. Register the script in `.claude/settings.json` and/or
   `.codex/hooks.json` under the correct phase + matcher.
3. Add smoke cases to `nexus/scripts/hooks/test.mjs` `cases[]` array.
4. Run `bun run hooks:test` to confirm green.
5. The config validator (C. layer) automatically picks up the new
   hook entry — no extra wiring needed.

## Rule owner

[AGENTS.md EPR-029](../../../AGENTS.md) — 硬化质量门到 Git/CI/AI 钩子.
