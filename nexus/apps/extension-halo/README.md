# HALO

HALO is a SidePanel-first local productivity and developer-tool application inside the NEXUS monorepo.

## Start here

- [Documentation map](docs/README.md)
- [Architecture](docs/architecture.md)
- [Roadmap](docs/roadmap.md)
- [Privacy policy](PRIVACY.md)
- [Research](docs/research/README.md)
- [Proposals](docs/proposals/README.md)
- [Repository documentation](../../docs/README.md)

## Development

Run from the `nexus/` workspace:

```bash
bun install
bun run --cwd apps/extension-halo typecheck
bun run --cwd apps/extension-halo build:prod
bun run --cwd apps/extension-halo test:ui
bun run --cwd apps/extension-halo test:playwright
```

The repository toolchain is pinned to **Bun 1.3.14**.

## Product boundaries

- Local processing and persistence are the default.
- Network-backed features are separate explicit capabilities with narrow permissions and disclosure.
- HALO has no advertising, analytics, telemetry, or developer-operated collection service. Optional network tools disclose their destinations and inputs in the privacy policy.
- `tool`, `script`, and `system` are distinct plugin types.
- Generated registry and permission metadata are executable truth; documentation does not freeze tool counts.
- Work that must survive SidePanel closure has an explicit Background owner and recovery model.

Current behavior is defined by source, registry metadata, tests, and production artifacts. Roadmaps, research, and proposals do not prove completion.
