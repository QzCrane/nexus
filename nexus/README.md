# Nexus workspace

The `nexus/` directory is the Bun monorepo for the SPECTRA and HALO browser-extension ecosystem.

```text
contracts -> kernel -> shared feature packages -> applications
```

The dependency arrows describe ownership, not permission to import arbitrary internals. Applications consume shared packages through their public facades; contracts describe wire and data shapes without application behavior.

## Applications

- [SPECTRA](apps/extension-spectra/README.md): audio, video, playback, hotkey, and authenticated remote control.
- [HALO](apps/extension-halo/plan.md): SidePanel developer and productivity toolkit.
- Cortex: concept only; no active application owner exists in this repository.

## Shared packages

- `@nexus/contracts`: shared contracts and runtime guards
- `@nexus/kernel`: shared RPC, storage, and logging boundaries
- `@nexus/ui-kit`: reusable UI components
- `@nexus/audio-engine`: admitted WebAudio graph construction and readback

Counts of tools, capabilities, algorithms, and invariants belong to executable registries or contracts. Navigation documents do not duplicate those counts as durable facts.

## Development commands

Run from the repository root unless a command explicitly documents another working directory:

```bash
bun install --cwd nexus
bun run dev
bun run build
bun run lint
bun run typecheck
bun run verify
bun run generate-registry
```

Use application-specific tests and production-artifact checks before release. The canonical quality checklist is [docs/principles/04-process-and-quality.md](docs/principles/04-process-and-quality.md).

## Public repository synchronization

The private monorepo may generate public SPECTRA or HALO repositories through the maintained synchronization scripts. Treat generated output as a release artifact:

1. run the appropriate sync script;
2. inspect the generated repository diff and exclusions;
3. run its validation suite;
4. push through the documented release workflow.

Do not use force-push as the default synchronization behavior. A history rewrite requires an explicit release decision and a verified target branch.

## Documentation

- [Documentation map](docs/documentation-index.md): canonical inventory and authority order
- [Engineering principles](docs/engineering-principles.md): EPR-001..029 index
- [Portfolio roadmap](plan.md): current milestones and unresolved decisions
- [Business model](docs/business-model.md): commercial hypotheses and privacy constraints
- [SPECTRA control architecture](apps/extension-spectra/docs/control-architecture.md)
- [SPECTRA runtime protocols](apps/extension-spectra/docs/protocols.md)
- [SPECTRA runtime topology](apps/extension-spectra/docs/architecture.md)
- [HALO architecture and roadmap](apps/extension-halo/plan.md)

## Repository constraints

Repository-wide constraints are owned by [`../rules.md`](../rules.md). Domain documents may tighten those constraints for a subsystem, but a README, roadmap, research note, or store listing cannot override an executable contract or release gate.