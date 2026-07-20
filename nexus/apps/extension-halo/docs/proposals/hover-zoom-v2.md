---
type: explanation
status: draft
audience: developer
owner: halo-hover-zoom
last_reviewed: 2026-07-20
---

# HALO Hover Zoom proposal

This document records intended architecture, acceptance criteria, and remaining work for HALO's hover-preview capability. Historical completion marks and competitor measurements from January 2026 must be confirmed against current source and tests before being treated as landed behavior.

## Product boundary

Hover Zoom resolves a user-targeted page asset into a preview without taking over the page's media lifecycle. It may display an image, a directly playable video, or a supported stream assembled through an owned viewer. It must preserve page interaction, avoid hidden network work while inactive, and dispose every listener, request, media source, animation, and object URL.

## Architecture

```text
hover-zoom/
├─ core/                 orchestration and lifecycle
├─ resolvers/            bounded source resolution
├─ rules/                declarative site and generic rules
├─ viewer/               image/video/gallery presentation
├─ network/              permissioned fetch/proxy boundary
├─ state/                owned settings and session state
└─ locales/              user-visible text
```

Durable constraints:

- one resolver-result contract;
- generic rules before site-specific exceptions unless a proven precedence rule says otherwise;
- site rules declare hosts, permissions, and network behavior;
- resolution and rendering are separate;
- the viewer owns one current preview and one disposer;
- no page-global arrays, jQuery dependency, or all-sites plugin bundle;
- no fixed file-size or line-count claim substitutes for responsibility boundaries.

## Resolution contract

A resolved item identifies:

- source URL or typed stream components;
- media type and confidence;
- source page and optional site adapter;
- fallback candidates in deterministic order;
- optional gallery membership;
- optional metadata with known provenance;
- required permissions or headers;
- cancellation and expiry behavior.

A thumbnail-to-original rewrite is accepted only when validated or when failure is recoverable through the declared fallback chain. A guessed URL is not success.

## Viewer lifecycle

The viewer must:

- cancel obsolete resolution and network work when the target changes;
- prevent stale responses from replacing a newer preview;
- avoid interfering with page video the user is already controlling;
- pause animation and optional media while hidden;
- release MediaSource, SourceBuffer, object URL, events, observers, and animations on close;
- isolate keyboard commands while pinned without permanently swallowing page input;
- keep geometry changes bounded to the viewer rather than rewriting page layout.

## Capability evidence to verify

January 2026 notes claim the implementation contained:

- a configurable information bar;
- ratio and scale calculation;
- Bilibili image and DASH resolution;
- a MediaSource-based video path;
- pinned viewer movement and resizing;
- incremental media loading and thumbnail fallback behavior.

These are review targets, not current release guarantees. Confirm each through current symbols, tests, and browser smoke before updating status.

## Remaining work

### P0: architecture and correctness

- prove cancellation and stale-result rejection across rapid hover changes;
- verify every resolver/site rule has bounded host and permission behavior;
- test source replacement, framework reparenting, hidden tabs, navigation, and viewer disposal;
- validate MediaSource error recovery, SourceBuffer sequencing, and memory release;
- replace undocumented background proxy behavior with typed requests and response guards.

### P1: fallback and interaction

- deterministic fallback chain with per-candidate failure reason;
- gallery navigation with adjacent-item prefetch limits;
- zoom/pan and pinned mode with accessible keyboard/focus behavior;
- metadata display only when derived from a trustworthy source;
- download naming and output rules that reject unsafe paths and unsupported schemes.

### P2: optional presentation

- ambient background effects with explicit CPU/GPU and reduced-motion boundaries;
- rotation or flip owned by the viewer;
- advanced stream formats only when package size, browser support, licensing, and lifecycle cost are justified.

## Bilibili integration

Bilibili-specific resolution is an adapter, not permission to depend on undocumented endpoints indefinitely. It isolates API shape changes, validates response fields, handles authentication/region/rate limits, and degrades to the next declared candidate.

Danmaku is a separate optional proposal: [`bilibili-danmaku.md`](bilibili-danmaku.md). Hover preview remains complete without it.

## Performance evidence

Do not retain fixed claims such as “6 KB versus 1 MB,” “zero allocation,” or guaranteed frame rate without a reproducible production-build benchmark. Measure at least:

- initial idle cost;
- first hover-to-preview latency by media type;
- cancellation latency;
- peak memory for large images and streamed video;
- hidden-tab/background work;
- viewer close and navigation cleanup;
- package contribution by optional feature.

## Acceptance gate

A phase is complete only when current source and tests prove:

1. deterministic resolution and fallback;
2. identity-bound stale-result rejection;
3. permission and network disclosure;
4. complete viewer disposal;
5. accessible keyboard, focus, and reduced-motion behavior;
6. measured production performance;
7. updated architecture, registry metadata, and release projection.

Historical change notes remain in Git history. New implementation evidence belongs in dated verification reports rather than an ever-growing proposal changelog.