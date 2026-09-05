# HALO

HALO is a SidePanel-first local productivity and developer-tool application inside the NEXUS monorepo.

It keeps ordinary processing and persistence on the user's device while exposing network-backed operations only as explicit, user-invoked capabilities. See the [privacy policy](PRIVACY.md) for exact storage, permission, and data-flow boundaries.

## Build from source

Use the repository-pinned Bun **1.4.0** toolchain from the repository root:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run build
bun run --cwd apps/extension-halo build:prod
```

The unpacked production extension is written to `apps/extension-halo/dist/`. Load that directory from `chrome://extensions` with Developer mode enabled.

## Install a packaged release

Download the versioned ZIP and matching SHA-256 file from the repository's Releases page, verify the checksum, extract the ZIP, and load the extracted directory through `chrome://extensions`. GitHub publication and Chrome Web Store publication are independent release states; the presence of a GitHub package does not claim a live store listing.

## Product boundaries

- Local processing and persistence are the default.
- Network-backed features are separate explicit capabilities with narrow permissions and disclosure.
- HALO has no advertising, analytics, telemetry, or developer-operated collection service. Optional network tools disclose their destinations and inputs in the privacy policy.
- `tool`, `script`, and `system` are distinct plugin types.
- Generated registry and permission metadata are executable truth; documentation does not freeze tool counts.
- Work that must survive SidePanel closure has an explicit Background owner and recovery model.

Current behavior is defined by source, registry metadata, tests, and production artifacts. Roadmaps, research, and proposals do not prove completion.

HALO is distributed under the MIT License.
