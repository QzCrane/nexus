---
type: reference
status: stable
audience: developer
owner: halo-documentation
last_reviewed: 2026-07-20
---

# HALO documentation

HALO documentation is divided by responsibility so architecture, sequencing, research, and speculative designs cannot silently overwrite one another.

```text
docs/
├── README.md
├── architecture.md
├── module-lifecycle.md
├── roadmap.md
├── sidepanel-storage-authority.md
├── research/
│   ├── README.md
│   ├── market-landscape-2025.md
│   └── feature-gap-analysis.md
└── proposals/
    ├── README.md
    ├── hover-zoom-v2.md
    └── bilibili-danmaku.md
```

## Authority

- [`architecture.md`](architecture.md) owns durable module, registry, lifecycle, permission, i18n, state, and performance boundaries.
- [`module-lifecycle.md`](module-lifecycle.md) owns packaged-module installation, degradation, retry, and live storage projection.
- [`sidepanel-storage-authority.md`](sidepanel-storage-authority.md) owns the SidePanel realm's physical storage transport and per-domain storage authorities.
- [`roadmap.md`](roadmap.md) owns current sequencing and unresolved engineering work.
- [`research/`](research/README.md) contains dated evidence and candidate gaps.
- [`proposals/`](proposals/README.md) contains designs that have not passed implementation gates.
- [`../README.md`](../README.md) is the product/developer entrypoint.
- [`../PRIVACY.md`](../PRIVACY.md) owns the public network, storage, retention, and developer-collection disclosure.
- [`../store-listings/README.md`](../store-listings/README.md) owns localized store copy, permission declarations, release notes, and reproducible listing assets.

Executable registry data, source, tests, build output, and release gates remain implementation truth. A proposal or roadmap item becomes current behavior only after the architecture owner and executable evidence close together.

## Completion contract

A HALO capability closes only when all applicable layers agree:

```text
metadata → permissions → implementation → lifecycle/recovery → i18n → tests → docs → production artifact → release projection
```

Fixed tool totals, version headings, competitor lists, and checklist marks are not completion evidence.
