---
type: explanation
status: draft
audience: developer
owner: halo-hover-zoom
last_reviewed: 2026-07-20
---

# HALO Hover Zoom proposal

This document outlines architecture, resolution contracts, and remaining work for HALO's hover-preview capability.

## Product Boundary & Architecture

Hover Zoom displays an image, video, or supported stream preview without taking over page media lifecycles.

```text
hover-zoom/ (core / resolvers / rules / viewer / network / state / locales)
```

- Resolution & rendering are strictly separated; the viewer owns one current preview and one disposer.
- No page-global arrays, jQuery dependencies, or unbounded all-sites plugin bundles.

## Resolution Contract & Viewer Lifecycle

- **Resolver Contract**: Identifies source URL/stream components, type confidence, site adapter, deterministic fallback order, gallery info, and permissions.
- **Viewer Lifecycle**: Cancels obsolete network requests on hover changes; pauses media/animation when hidden; disposes MediaSource, SourceBuffer, object URLs, and observers on close.

## Work Backlog & Priorities

- **P0 Architecture**: Cancellation across rapid hover; bounded host/permission behavior; MediaSource error recovery & cleanup.
- **P1 Interaction**: Deterministic fallback chain; gallery prefetch limits; keyboard/focus accessible zoom & pan.
- **P2 Presentation**: Ambient background effects; viewer-owned rotation/flip.

## Bilibili Integration & Performance

- Bilibili preview is an isolated adapter with response validation & fallbacks. See [`bilibili-danmaku.md`](bilibili-danmaku.md) for optional danmaku specs.
- Performance claims require reproducible benchmarks (idle cost, first hover latency, memory peaks, background wake).

## Acceptance Gate

Requires deterministic resolution, identity-bound stale result rejection, permission disclosure, 100% viewer disposal, accessible controls, and measured production performance.
