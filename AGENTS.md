# NEXUS agent instructions

<!-- gitnexus:keep -->

## Required sources

Read these before changing the repository:

1. [`rules.md`](rules.md): repository-wide constraints.
2. [`nexus/docs/documentation-index.md`](nexus/docs/documentation-index.md): documentation authority and domain owners.
3. The application or package owner document for the behavior being changed.
4. The relevant contracts, implementation, tests, and release gates.

Do not treat this file as a second copy of the rules. It is the agent entrypoint and generated skill index.

## Working boundary

- Primary workspace: `nexus/`
- Runtime and package manager: Bun
- Use repository scripts rather than inventing parallel commands.
- Generated files are changed through their source/generator.
- Before editing a shared symbol, inspect callers, identities, lifecycle ownership, failure paths, tests, and release projections.
- Close behavior through contract, implementation, tests, owner documentation, and applicable privacy/release evidence.

## Project skills

The source of truth is [`.agents/skills/`](.agents/skills/). `bun run sync:skills` refreshes the table between the markers below.

<!-- nexus:skills-start -->
| Skill | Description | Triggers |
|---|---|---|
<!-- nexus:skills-end -->

## Stop conditions

Do not declare work complete while the diff contains a known broken link, duplicated authority, stale generated output, failing required check, unresolved lifecycle leak, unverified public claim, or an unexplained change outside the requested scope.