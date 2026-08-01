---
type: reference
status: stable
audience: contributor
owner: halo-store-copy
last_reviewed: 2026-08-01
---

# HALO store-listing maintenance

This directory projects one verified production candidate into store copy, privacy declarations, release notes, and listing assets. Locales may translate tone, but capability, limitation, permission, and network statements must remain equivalent.

## Sources of truth

- runtime and lifecycle: [`../docs/architecture.md`](../docs/architecture.md)
- network, storage, and retention: [`../PRIVACY.md`](../PRIVACY.md)
- manifest and Dashboard declarations: [`privacy-justifications.md`](privacy-justifications.md)
- implemented behavior: registry metadata, source, tests, production package, and the current release-gate output

Roadmaps, proposals, screenshots, and older listing text are not behavior authority.

## Current locale and asset projection

- English: [`en-US.md`](en-US.md)
- Simplified Chinese: [`zh-CN.md`](zh-CN.md)
- Candidate notes: [`release-notes-0.6.1.md`](release-notes-0.6.1.md)
- Required screenshot: `assets/halo-sidepanel-1280x800.png`
- Extension icons: `../public/icon16.png`, `../public/icon48.png`, and `../public/icon128.png`

Regenerate the screenshot from the production extension with Bun 1.3.14:

```bash
bun run --cwd apps/extension-halo capture:store-assets
```

The capture script builds production output, loads that exact unpacked extension in Chromium, waits for the tool registry UI, captures 1280×800 PNG, verifies the PNG dimensions, and cleans its temporary profile. Review the image visually before publication.

## Publication gate

Before each Chrome Web Store submission:

1. Revalidate current listing, privacy, permission, remote-code, and image requirements from Chrome's primary documentation.
2. Compare the exact submitted manifest with `privacy-justifications.md`.
3. Compare both locale descriptions with `PRIVACY.md` and the production network inventory.
4. Run the maintained HALO release gate and the explicit production Chromium test.
5. Regenerate and visually review the screenshot.
6. Record the authenticated store submission status separately from GitHub release publication.

If primary policy sources or the authenticated Dashboard are unavailable, the Chrome Web Store submission remains blocked. A ZIP or GitHub Release does not satisfy this gate.
