# NEXUS Skills (Source of Truth)

This directory is the **single source of truth** for all NEXUS project
skills. It follows the
[Anthropic Agent Skills open spec](https://agentskills.io/specification).

## Why here (and not in `nexus/.skills/`)

- Matches the official [`anthropics/skills`](https://github.com/anthropics/skills)
  repo convention: source lives at the same level as `AGENTS.md` /
  `CLAUDE.md` and the `.claude-plugin/` metadata.
- Keeps "declaration + implementation" colocated at the repo root so IDEs
  and humans find the source without diving into `nexus/`.

## Layout

```
.skills/
├── add-dependency/SKILL.md
├── finish-feature/SKILL.md
├── lint/SKILL.md
├── new-module/SKILL.md
├── release-halo/SKILL.md
├── release-spectra/SKILL.md
├── sync-nexus/SKILL.md
├── test/SKILL.md
├── typecheck/SKILL.md
├── update-context/SKILL.md
└── verify/SKILL.md
```

## How it works

Run `bun run sync:skills` (from `nexus/`) to mirror this directory into:

| Output | Loaded by | Body |
|---|---|---|
| `<repo>/.claude/skills/<name>/SKILL.md` | Claude Code | verbatim |
| `<repo>/.codex/skills/<name>/SKILL.md` | Codex | verbatim |
| `<repo>/.agent/workflows/<name>.md` | Antigravity / TRAE | `// turbo` injected before each bash block |
| `<repo>/AGENTS.md` § Project Skills | every editor | auto-generated index table |

The script is idempotent and runs automatically as part of `bun run prebuild`,
so generated outputs stay in sync with this source on every build.

## Frontmatter spec

Each `SKILL.md` MUST start with YAML frontmatter containing at least `name`
and `description`. The other fields used here are all spec-compliant:

| Field | Required | Notes |
|---|---|---|
| `name` | ✅ | Lowercase, alphanumeric + hyphens, must match directory name |
| `description` | ✅ | ≤1024 chars, include trigger phrases |
| `license` | optional | Short name; full terms in `LICENSE.txt` (TBD) |
| `compatibility` | optional | Environment requirements (bun, PowerShell, etc.) |
| `metadata` | optional | Custom key/value map; we use `category`/`app`/`phase`/`user-invocable` |
| `allowed-tools` | optional | **Space-separated string** (e.g. `Bash Read Edit Grep`) |

The body is plain Markdown; recommended sections are
`## Trigger` / `## Process` / `## Anti-Rationalization` / `## Verification`.

## Adding a new skill

1. `mkdir .skills/<name>` (lowercase, hyphens only)
2. Write `SKILL.md` with valid frontmatter
3. Run `bun run sync:skills` — auto-mirrors to all three loaders and
   injects the row into `AGENTS.md`
4. Commit `.skills/<name>/SKILL.md`; the generated outputs will be
   refreshed by the next `bun run build` (or `prebuild`)
