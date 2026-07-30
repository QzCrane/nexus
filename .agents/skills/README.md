# NEXUS project skills

`.agents/skills/` is the repository source of truth for project-specific agent workflows. Each skill lives in `<name>/SKILL.md` and follows the frontmatter shape consumed by `nexus/scripts/sync-skills.mjs`.

## Ownership

- Edit the `SKILL.md` in this directory.
- Do not create a second `.skills/`, `.codex/skills/`, or repository workflow mirror.
- `nexus/scripts/sync-skills.mjs` validates source directories and refreshes the Project Skills table in [`../../AGENTS.md`](../../AGENTS.md).
- Repository documentation ownership is defined by [`../../nexus/docs/README.md`](../../nexus/docs/README.md).

## Toolchain

All executable skill commands target **Bun 1.3.14**. A skill must not introduce another Bun version, package manager, lockfile, or parallel command path. Dynamic external-tool behavior is revalidated before a skill claims support.

## Current skill directories

- `add-dependency`
- `finish-feature`
- `lint`
- `new-module`
- `release-halo`
- `release-spectra`
- `sync-nexus`
- `test`
- `typecheck`
- `update-context`
- `verify`

This list is descriptive. The sync script discovers actual skill directories and owns the generated index.

## Frontmatter

Each `SKILL.md` starts with YAML frontmatter containing at least:

- `name`: lowercase letters, numbers, and hyphens; matches the directory name;
- `description`: concrete capability statement with trigger phrases.

Optional fields may include `license`, `compatibility`, `metadata`, and `allowed-tools`. Preserve nested frontmatter instead of flattening and rebuilding it through a lossy parser.

The body makes the workflow executable. Use trigger, prerequisites, process, prohibited shortcuts, verification, and completion evidence where useful. Link canonical architecture/roadmap owners rather than deprecated aliases.

## Updating skills

From the repository root:

```bash
bun run sync:skills
bun run docs:check
bun --cwd nexus run check:toolchain
bun run hooks:test
```

Then inspect:

- the generated `AGENTS.md` table;
- commands and paths against current package scripts;
- Bun 1.3.14 references;
- documentation ownership and release authorization boundaries.

A new or changed skill is incomplete until frontmatter parses, the generated index contains it, commands match actual scripts, documentation links resolve, and applicable tests pass.

## External specifications

External skill specifications and loader behavior can change. Revalidate current official documentation before adding a field or claiming support for another tool. This README records repository policy, not a permanent list of third-party products.