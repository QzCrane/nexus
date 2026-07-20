# NEXUS project skills

`.agents/skills/` is the repository source of truth for project-specific agent skills. Each skill lives in `<name>/SKILL.md` and follows the Agent Skills frontmatter shape used by the repository loader.

## Ownership

- Edit the `SKILL.md` in this directory.
- Do not create a second `.skills/`, `.claude/skills/`, `.codex/skills/`, or workflow mirror inside the repository.
- `nexus/scripts/sync-skills.mjs` validates the source directories and refreshes the Project Skills table in [`../../AGENTS.md`](../../AGENTS.md).
- [`../../CLAUDE.md`](../../CLAUDE.md) mirrors `AGENTS.md`; the local post-analyze hook restores their hardlink after GitNexus regeneration.

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

The directory list is descriptive. The sync script discovers actual skill directories and is the executable owner of the generated index.

## Frontmatter

Each `SKILL.md` starts with YAML frontmatter containing at least:

- `name`: lowercase letters, numbers, and hyphens; matches the directory name;
- `description`: a concrete capability statement with trigger phrases.

Optional fields may include `license`, `compatibility`, `metadata`, and `allowed-tools`. Preserve nested frontmatter instead of flattening and rebuilding it through a lossy parser.

The body should make the workflow executable. Use sections such as trigger, prerequisites, process, prohibited shortcuts, verification, and completion evidence when they improve clarity.

## Updating skills

From the repository root:

```bash
bun run sync:skills
```

Then inspect the `AGENTS.md` index diff and run the maintained skill validation or pre-push gate. A new directory is not complete until its frontmatter parses, the generated index contains it, its commands match the repository toolchain, and its verification steps are current.

## External specifications

External skill specifications and loader behavior can change. Revalidate their current official documentation before adding a field or claiming support for another tool. This README records repository policy, not a permanent list of third-party products.