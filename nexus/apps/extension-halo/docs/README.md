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
├── roadmap.md
├── research/
│   ├── README.md
│   ├── market-landscape-2025.md
│   └── feature-gap-analysis.md
├── proposals/
│   ├── README.md
│   ├── hover-zoom-v2.md
│   └── bilibili-danmaku.md
├── research.md                    # deprecated migration alias
├── feature-gap-analysis.md        # deprecated migration alias
├── plan-hover-zoom-v2.md          # deprecated migration alias
└── plan-danmaku.md                # deprecated migration alias
```

## Authority

- [`architecture.md`](architecture.md) owns durable module, registry, lifecycle, permission, i18n, state, and performance boundaries.
- [`roadmap.md`](roadmap.md) owns current sequencing and unresolved engineering work.
- [`research/`](research/README.md) contains dated evidence and candidate gaps.
- [`proposals/`](proposals/README.md) contains designs that have not passed implementation gates.
- [`../README.md`](../README.md) is the product/developer entrypoint.

Executable registry data, source, tests, build output, and release gates remain implementation truth. A proposal or roadmap item becomes current behavior only after the architecture owner and executable evidence close together.

## Completion contract

A HALO capability closes only when all applicable layers agree:

```text
metadata → permissions → implementation → lifecycle/recovery → i18n → tests → docs → production artifact → release projection
```

Fixed tool totals, version headings, competitor lists, and checklist marks are not completion evidence.