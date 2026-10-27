# NEXUS

This repository contains the primary Bun monorepo in [`nexus/`](nexus/) plus the independently deployed [`remote-site/`](remote-site/) surface.

## Start here

- [Repository rules](rules.md)
- [Documentation architecture](nexus/docs/README.md)
- [Workspace](nexus/README.md)
- [Portfolio roadmap](nexus/docs/product/roadmap.md)
- [SPECTRA](nexus/apps/extension-spectra/README.md)
- [HALO](nexus/apps/extension-halo/README.md)
- [Agent workflows](.agents/skills/README.md)

## Repository layout

```text
.
├── nexus/                 Bun monorepo: apps, packages, scripts, tests, docs
├── remote-site/           separately deployed SPECTRA remote controller
├── .agents/skills/        project workflow sources
├── .github/workflows/     repository quality gates
├── rules.md               repository-wide constraints
└── AGENTS.md              agent entrypoint and generated skill index
```

The legacy root `spectra.md` was a deprecated alias removed after its migration window closed; SPECTRA specification now lives in [`nexus/apps/extension-spectra/docs/README.md`](nexus/apps/extension-spectra/docs/README.md).

## Toolchain

The repository and generated public workspaces are pinned to **Bun 1.4.4**.

Run from the repository root:

```bash
bun install
bun run dev
bun run build
bun run lint
bun run typecheck
bun run verify
bun run docs:check
bun run generate-registry
```

Root scripts proxy into `nexus/` so contributors and automation use one stable working boundary. Application-specific browser, UI, production-artifact, privacy, and release checks remain mandatory when their scope is affected.
