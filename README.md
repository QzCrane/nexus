# NEXUS

This repository contains the primary Bun monorepo in [`nexus/`](nexus/), plus the independently deployed [`remote-site/`](remote-site/) surface.

## Start here

- Product, package, and workspace work starts in [`nexus/`](nexus/).
- Repository-wide engineering constraints are owned by [`rules.md`](rules.md).
- The complete documentation map and authority rules are in [`nexus/docs/documentation-index.md`](nexus/docs/documentation-index.md).
- SPECTRA control behavior starts at [`nexus/apps/extension-spectra/docs/control-architecture.md`](nexus/apps/extension-spectra/docs/control-architecture.md).
- HALO planning and architecture start at [`nexus/apps/extension-halo/plan.md`](nexus/apps/extension-halo/plan.md).
- Touch [`remote-site/`](remote-site/) only for the separately deployed SPECTRA remote client.

## Repository layout

- `nexus/`: applications, shared packages, contracts, scripts, tests, and active engineering documentation
- `remote-site/`: static authenticated SPECTRA remote client and deployment headers
- `.agents/skills/`: generated and maintained agent workflows
- `rules.md`: repository-wide workflow, security, quality, and environment constraints
- `spectra.md`: deprecated legacy SPECTRA recovery specification; retained only as a redirect to current owners

## Common commands

Run these from the repository root:

```bash
bun install --cwd nexus
bun run dev
bun run build
bun run lint
bun run typecheck
bun run verify
bun run generate-registry
```

The root scripts proxy into the nested workspace so automated tools do not need to guess the working directory.