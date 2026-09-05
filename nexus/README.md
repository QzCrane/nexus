# Nexus workspace

The `nexus/` directory is the Bun monorepo for the SPECTRA and HALO browser-extension ecosystem.

```text
contracts → kernel → shared feature packages → applications
```

Dependency arrows describe ownership, not permission to import arbitrary internals. Applications consume shared packages through public facades; contracts describe wire and data shapes without application behavior.

## Applications

- [SPECTRA](apps/extension-spectra/README.md): audio, video, playback, hotkey, and authenticated remote control.
- [HALO](apps/extension-halo/README.md): SidePanel developer and productivity toolkit.
- Cortex: concept only; no active application owner exists in this repository.

## Shared packages

- `@nexus/contracts`: shared contracts and runtime guards
- `@nexus/kernel`: shared RPC, storage, and logging boundaries
- `@nexus/ui-kit`: reusable UI components
- `@nexus/audio-engine`: admitted WebAudio graph construction and readback

Counts of tools, capabilities, algorithms, and invariants belong to executable registries or contracts. Navigation documents do not duplicate those counts as durable facts.

## Toolchain and commands

The entire workspace is pinned to **Bun 1.4.0**.

Run from the repository root:

```bash
bun install
bun run dev
bun run build
bun run lint
bun run typecheck
bun run check:platform
bun run verify
bun run docs:check
bun run generate-registry
```

Use application-specific tests and production-artifact checks before release. The quality owner is [EPR-026..029](docs/principles/04-process-and-quality.md).

## Documentation

- [Documentation architecture](docs/README.md)
- [Engineering principles](docs/engineering/README.md)
- [Portfolio roadmap](docs/product/roadmap.md)
- [Business model](docs/product/business-model.md)
- [Research standard](docs/research/README.md)
- [SPECTRA documentation](apps/extension-spectra/docs/README.md)
- [HALO documentation](apps/extension-halo/docs/README.md)

## Public repository synchronization

The private monorepo may generate public SPECTRA or HALO repositories through the maintained synchronization script. Generated output is a release artifact:

1. finish the applicable private-source gates without pushing;
2. run the appropriate sync command, which batch-reads committed `HEAD`, installs, and runs the retained public lint, typecheck, and build commands before creating a candidate;
3. inspect exclusions, validation output, and the single generated repository diff;
4. verify the generated package remains pinned to Bun 1.4.0;
5. push only through an authorized release workflow.

The script preserves the destination repository's existing `.git` directory and an ignored Turbo cache under `node_modules`; it does not transplant private-repository history. A failed public gate cannot create a candidate commit. Force-push is not the default.

## Repository constraints

Repository-wide constraints are owned by [`../rules.md`](../rules.md). Domain documents may tighten constraints for a subsystem, but a README, roadmap, research note, proposal, or store listing cannot override executable contracts or release gates.
