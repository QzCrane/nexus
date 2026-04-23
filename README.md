# NEXUS

This repository is a wrapper around the real Bun monorepo in `./nexus` plus the separate `remote-site/` surface.

## Start Here

- Enter the main workspace under `nexus/` for most product work.
- From the repo root, use the proxy scripts in `package.json` so Codex web can run the correct nested commands without guessing the working directory.

## Repository Layout

- `nexus/`: primary monorepo containing `apps/extension-halo`, `apps/extension-spectra`, shared packages, scripts, and docs
- `remote-site/`: separate site/deployment surface
- `rules.md`: root project rules that apply outside the nested monorepo as well

## Common Commands

- `bun install --cwd nexus`
- `bun run dev`
- `bun run build`
- `bun run lint`
- `bun run typecheck`
- `bun run verify`
- `bun run generate-registry`

If a task is about the extensions, contracts, kernel, or shared packages, work inside `nexus/`. Only touch `remote-site/` when the request is explicitly about that deployment surface.
