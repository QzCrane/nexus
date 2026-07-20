---
type: explanation
status: draft
audience: developer
created: 2026-01-09
last_reviewed: 2026-07-20
---

# Bilibili danmaku proposal

This is an optional Hover Zoom workstream. It is not a shipped capability and is not required for the core preview lifecycle.

Bilibili endpoints, protobuf shapes, access rules, rate limits, and browser behavior are time-sensitive. Revalidate them against current official behavior and captured test fixtures before implementation. Do not embed a network contract in production solely from the historical endpoint examples formerly stored in this file.

## Product boundary

The capability displays user-requested timed comments over a supported Bilibili preview. It must:

- start only for an explicit supported preview;
- disclose and constrain external requests;
- avoid retaining account identifiers or comment history beyond the active preview unless a separate product decision permits it;
- remain optional and independently disposable;
- degrade to video without danmaku when data is unavailable, malformed, blocked, or too expensive to render.

## Proposed architecture

```text
hover-zoom/
└─ viewer/danmaku/
   ├─ index.ts
   ├─ types.ts
   ├─ decoder.ts
   ├─ timeline.ts
   ├─ renderer.ts
   └─ controller.ts
```

Responsibilities:

- **adapter**: obtain the current media identifier and typed request parameters;
- **decoder**: parse bounded untrusted bytes into validated items;
- **timeline**: index items by media time and expose seek/reset operations;
- **renderer**: draw an already-selected visible set without owning network or video state;
- **controller**: bind one video, settings snapshot, cancellation signal, and disposer.

The split is by ownership. File length is a review signal, not the acceptance criterion.

## Data model

```ts
interface DanmakuItem {
  id: string;
  timeMs: number;
  mode: 'scroll' | 'top' | 'bottom';
  fontSize: number;
  color: string;
  content: string;
  weight?: number;
}
```

All fields are range-checked. Invalid UTF-8, oversized content, unsupported modes, extreme timestamps, duplicate IDs, excessive counts, and malformed wire data are rejected or normalized through documented rules.

Do not expose sender hashes or account identifiers to the renderer when they are not needed for the product.

## Network boundary

The Bilibili adapter must declare:

- exact host permissions;
- request method, response type, and maximum accepted bytes;
- segmentation and pagination limits;
- timeout, cancellation, retry, and rate-limit behavior;
- authentication/cookie policy;
- response validation and version fallback;
- privacy and store disclosure impact.

Background proxying does not remove these obligations. It is a transport boundary, not permission to fetch arbitrary URLs or forward ambient page credentials.

## Decoder requirements

A hand-written protobuf decoder is acceptable only when the supported schema is narrow, fixtures cover all wire types used, unknown fields are safely skipped, integer overflow is handled, and malformed length-delimited fields cannot allocate unbounded memory.

Using a maintained protobuf implementation may be safer if its package and bundle cost are acceptable. “No dependency” is not automatically lower risk.

Required tests include:

- empty and truncated messages;
- overlong varints and integer boundaries;
- unknown fields and reordered fields;
- invalid lengths and excessive item counts;
- Unicode and zero-length content;
- recorded valid fixtures from each supported endpoint version.

## Timeline and rendering

The controller follows the bound video's actual events:

- play/pause controls animation;
- seek and source replacement reset the timeline;
- playback-rate changes adjust motion without rebuilding all items;
- resize updates the canvas at a bounded cadence;
- hidden or detached viewers stop rendering;
- disposal cancels fetch/decode work and removes every event and animation owner.

The renderer uses a bounded visible window and lane allocator. It must define overload behavior rather than promising to render every incoming item. Candidate policies include weight-based sampling, per-second caps, duplicate suppression, and user-controlled density.

Canvas is the default candidate because it provides one rendering surface and predictable cleanup. WebGL requires measured evidence that Canvas cannot meet the defined load; CSS elements are unsuitable for large unbounded item counts.

## Settings

Candidate settings:

```ts
interface DanmakuSettings {
  enabled: boolean;
  opacity: number;
  speed: number;
  fontScale: number;
  maxScreenRatio: number;
  density: number;
}
```

Every value has contract bounds and neutral defaults. Settings are local, versioned, and do not create network or rendering work while the capability is disabled.

## Acceptance criteria

- current endpoint and response behavior are documented with dated fixtures;
- host permissions and external data flow are reviewed;
- untrusted bytes are bounded and fully validated;
- playback, seek, rate, resize, hidden-state, source-change, and dispose tests pass;
- overload behavior is deterministic under large datasets;
- accessibility includes a disable control and reduced-motion-compatible behavior;
- production memory, CPU, frame pacing, and package cost are measured;
- failures leave the underlying preview usable and leak no requests, timers, canvases, or listeners.

The former ten-hour estimate was removed because it ignored endpoint investigation, security review, browser integration, fixtures, performance testing, accessibility, and maintenance risk.