---
type: reference
status: stable
audience: developer
owner: halo-architecture
last_reviewed: 2026-07-29
---

# HALO architecture

HALO is a SidePanel-first developer and productivity toolkit. This document owns durable module boundaries, registry semantics, state/lifecycle ownership, permissions, localization, and performance constraints. Executable registry data, source, tests, and release gates remain implementation truth.

Local-first is the default. Synchronization, external APIs, and cloud storage are separate explicit capabilities with narrow permissions, failure semantics, and disclosure; they are not hidden behind a blanket “zero network” claim.

## Runtime surfaces

```text
src/
├─ entry/                  background, content, sidepanel
├─ components/             shell, navigation, shared interaction
├─ kernel/                 registry, taxonomy, managers, shared services
├─ tools/<id>/             user-invoked panel tools
├─ scripts/<id>/           user-controlled script capabilities
├─ system/<id>/            settings, permissions, module management
└─ i18n/                   locale sources and generated aggregates
```

The exact directory tree may evolve. These ownership rules do not:

- `tool`, `script`, and `system` are distinct plugin types;
- system capabilities are not disguised as ordinary tools;
- registry metadata has one executable source;
- a plugin owns its state and lifecycle and communicates through public kernel boundaries;
- a panel component does not become the Background authority for work that must survive panel closure.

## Plugin contract

Each plugin declares enough metadata for registry generation, permission review, localization, loading, and lifecycle management. A typical tool may use:

```text
tools/<id>/
├─ manifest.json
├─ index.ts
├─ types.ts
├─ core.ts
├─ panel.tsx
└─ locales/
```

Files split by responsibility, not an absolute line quota. Large files are review signals; a split is valid only when it creates an explicit boundary rather than hiding one workflow across fragments.

### Naming

- plugin ID and directory: kebab-case;
- storage keys: owned, namespaced, and versioned;
- messages: typed contracts rather than copied string lists;
- React components may use PascalCase under local conventions;
- hooks use the existing `useCamelCase` convention.

## Registry and taxonomy

The registry is the source of plugin identity, type, category, loading metadata, and required permissions. Generated projections may include plugin lists and typed helpers, but no UI or Background module maintains a second manual inventory.

Taxonomy contains virtual views such as active, scripts, and system plus functional categories. Sorting and labels originate from the taxonomy/registry boundary and are translated at the UI edge.

A plugin count is a generated observation. Documentation does not freeze a total that can drift after the next registry change.

## SidePanel ownership

`src/entry/sidepanel.tsx` owns application composition, not plugin business logic.

Entry routes may include the browser action, context menus, and configured commands. Each route resolves a typed destination, reports restricted browser pages as bounded errors, and avoids duplicate state managers.

### UI system

- shared design tokens own color, spacing, surface, focus, and motion vocabulary;
- user-visible text and accessible names use canonical locale keys;
- native controls own ordinary activation; composite widgets keep primary and secondary actions separate, editable collections persist stable row identities, and only immutable coordinate projections may justify a narrow positional-key lint exception;
- animations respect user settings and reduced-motion preferences;
- a tool failure is isolated by the shared error boundary and does not destroy the shell;
- theme or dark-mode behavior embedded in Settings is an internal feature unless it satisfies the complete plugin contract.

## State and background work

Panel-local state may remain in the panel. Work that must continue after panel closure requires an explicit Background owner, persisted state model, wake/recovery behavior, and tests for service-worker suspension.

Do not keep a feature alive through unbounded intervals, hidden panels, or duplicated storage listeners. Prefer browser events, alarms, and narrowly owned lifecycle tokens.

`useToolState` keeps the existing raw Chrome-storage value ABI, but each
`(area, storageKey)` hook epoch owns one bounded write coordinator. The
coordinator permits one active write, one replaceable latest desired value, and
one debounce timer; it is state persistence rather than an event log, so
intermediate values never form an unbounded Promise queue. A structurally equal
owned write echo acknowledges that write without cancelling a newer local
intent. A different storage event becomes the new authority, cancels work that
has not started, and causes an already-active stale write to repair only the
latest winner after it settles. Key or area changes create a new epoch. Cleanup
seals captured setters before removing the listener and drains at most the
existing active write plus one frozen final desired value.

Hover Zoom's MediaSource path has one generation-scoped session owner for the
shared viewer. Session creation returns `{ ready, dispose }` synchronously, so
replacement, hide, and failure can retire source-open waits, append listeners,
interaction timers, SourceBuffers, and the object URL before the first segment
finishes. Promise, metadata, and timer callbacks must prove that their session
is still current before mutating the viewer, and a retired session cannot clear
a newer session's video source. The current Background proxy request protocol
does not transport an `AbortSignal`; an already-dispatched proxy request may
therefore finish physically, but its retired result is consumed without
recovering MSE or UI ownership.

## Permissions

Permissions are declared by executable plugin metadata and compiled into a reviewable usage map. A new permission identifies:

- the exact plugin and user action that needs it;
- whether it is install-time, optional, or runtime-granted;
- the data and browser surface it exposes;
- behavior when unavailable or revoked;
- tests and public disclosure where applicable.

Settings, the permission manager, and store copy consume the same permission source rather than maintaining parallel lists.

## Localization

Plugin locale sources remain local to the plugin and compile into generated runtime aggregates. Canonical keys are flat at the source boundary and are hydrated only by the maintained generator.

A plugin is incomplete when its name, description, primary actions, errors, or accessible labels are missing from required locales. Generated locale files are not edited manually.

## Performance boundaries

- inactive plugins allocate no recurring work;
- SidePanel visibility pauses optional rendering and sampling;
- registry generation happens at build time rather than by runtime directory scans;
- large data operations use bounded batches and cancellation;
- hot input paths avoid repeated parsing, allocation, layout reads, or storage writes;
- performance claims require measured startup, interaction, memory, and background-wake evidence.

“Zero allocation,” “zero CPU,” and fixed speedup factors are not documentation guarantees unless a release benchmark defines the workload and proves the claim.

### Smooth-scroll ownership

The page content module owns input admission and the shared animation engine owns only admitted displacement. The routing contract is structural:

- page input admission runs only in the top-level browsing context. Child frames remain browser-owned so a non-scrollable media or application frame can chain wheel input to its parent viewport;
- descendant page handlers get first refusal before HALO's bubble-phase window listener; a prevented or propagation-stopped event remains page-owned;
- embedded application surfaces, editable controls, fullscreen content, and explicitly marked virtual scrollers stay native. Audio and video elements are routing leaves rather than scroll owners: page handlers still get first refusal, then HALO may animate the nearest eligible ancestor without mutating a media layout;
- HALO animates only vertical overflow exposed by the browser as `auto`, `scroll`, or `overlay`; `hidden` and `clip` are layout boundaries and are never mutated as user scroll containers;
- the viewport has one canonical target, `Window`. Its effective overflow follows root/body propagation rules; a locked viewport yields to native behavior instead of being cancelled, while `blocked` is reserved for explicit containment boundaries;
- nested containers chain outward only after reaching their directional boundary. Only explicit `overscroll-behavior: contain|none` creates a containment barrier; position, size, class names, and child counts do not imply one;
- every admitted input re-resolves the current ancestor path. Target caching requires an explicit DOM/style generation contract; a time-to-live alone cannot prove that a nearer scroller or containment boundary did not appear;
- ordinary light-DOM wheel input follows `target.parentElement` without allocating a composed-path array. An event whose retargeted host, assigned slot, or non-document root requires shadow ancestry reads `composedPath()` at most once, so open shadow trees and slots retain their real ancestor order. Middle-click admission follows the same conditional composed ancestry. `MAX_SCROLL_ROUTE_ELEMENTS` bounds the structural preflight at 65 elements; an over-deep path yields natively before any computed-style read. Ordinary complete light-DOM paths use the browser's `closest` fast path, while composed paths use element matching. Only after that marker pass may routing read styles, and the nearest scroll or containment decision returns immediately; audio and video routing leaves are skipped before their own computed style is read, and root/body styles are reused only within that call and never cached across events;
- `respectReducedMotion` controls the system motion-policy boundary. When enabled, `prefers-reduced-motion: reduce` yields to native scrolling; otherwise the explicitly enabled Smooth Scroll tool keeps its requested animation behavior;
- coarse wheel ticks and fine-grained touchpad or high-resolution wheel streams share the same rAF animation owner. Page content and the SidePanel use the same allocation-free classifier while retaining separate per-surface gesture state. A strong coarse sample contributes exactly the configured base step; fine and ambiguous sub-threshold integer input preserve their physical delta. Repeated ambiguous integers remain on one fine trajectory instead of changing distance and dynamics on the second sample; a later strong coarse sample may promote the gesture without discarding already accepted distance. Acceleration changes response gain, never spatial distance. Classification controls source settings and response only; it never authorizes a synchronous `scrollTop` or `scrollBy` mutation;
- callers cancel native input only after the engine synchronously admits a live target with directional capacity;
- pending displacement has exactly one target. A target or direction change cancels old momentum, and idle, hidden, disabled, detached, or disposed states release the target and animation frame.

`HALO_SMOOTH_SCROLL_SETTINGS` in `storage.sync` is the only settings-distribution source; imported and persisted values pass through the same runtime normalizer. Runtime control changes use ordered zero-delay writes, and the shared state hook flushes any pending final value during unmount instead of discarding a visible toggle. Each directional route returns a same-call-stack admission snapshot so the engine does not repeat the route's style and capacity reads; the snapshot is never cached across input events. The SidePanel follows this same dynamic route rather than keeping a time-to-live or `WeakRef` target guess. Coarse-wheel acceleration is scoped to the canonical target and direction and cannot cross a routing boundary. `accelerationMax` remains storage-compatible but now caps response gain in both page content and the SidePanel; it does not multiply the configured step. A finite `WheelEvent.timeStamp` is used only for gesture ordering, axis lock, device evidence, and acceleration cadence. Animation dynamics start from `performance.now()` after synchronous admission, so time spent in the browser event queue or page handlers cannot be converted into a first-frame catch-up jump.

The engine coalesces all input received between display frames into one remaining-displacement state. Logical easing progress and browser-write carry are separate: subpixel quantization cannot freeze easing progress, and the next frame observes the previous write before issuing at most one new vertical write. Coarse input adds displacement without injecting a discrete velocity kick. Response gain converges toward its new target instead of changing spring stiffness instantaneously, and the tail planner intervenes only when the remaining displacement exceeds future physical drain capacity; ordinary motion therefore remains on one continuous critically damped trajectory. A vertical frame does not read or integrate the horizontal axis and does not read the vertical position after writing it. It overwrites one engine-private metrics scratch object rather than allocating a new metrics object per frame, then clears its DOM reference when ownership ends. Dynamic overflow, extent, position, and connectivity are still revalidated each frame rather than replaced by a time-based guess. Viewport writes explicitly use instant browser behavior so page CSS cannot create a competing smooth-scroll animation owner.

`SCROLL_LIMITS` in the engine is the sole executable owner of the **frame-level** physical envelope for both input modes; `COARSE_SCROLL_LIMITS` remains a source/test compatibility alias to that same frozen object, not a second authority. The frame envelope uses two independent bounds: maximum physical speed is `6 CSS px/ms` and maximum displacement in one display frame is `100 CSS px`. Neither frame bound depends on queued displacement or `animationTime`, and both are required to prevent jank at any animation duration.

The **time-level** envelope is derived from `animationTime` so that the user-facing field controls the actual animation duration instead of being silently capped. `tailBudgetMs()` returns `max(280, state.time + 32)`: the `280 ms` floor preserves the tested post-input ownership budget for short animations, while longer animations extend the tail deadline proportionally. `maxBacklogPx()` derives from `tailBudgetMs()` using the same formula as before: reserve `32 ms` for final browser-write observation and subtract the lost drain capacity of one `50 ms` frame capped at `100 px`, yielding `6 × (tailBudget − 32) − (6 × 50 − 100)`. At the default `animationTime=400` this gives `tailBudget=432`, `maxBacklog=2200`; at `animationTime=2000` it gives `tailBudget=2032`, `maxBacklog=11800`. Non-overloaded input preserves every physical fine delta or coarse base-step displacement; input beyond that outstanding capacity saturates at the bound so an unbounded device stream cannot create an unbounded latency tail.

The fine-mode time constant is `max(8, animationTime × 0.03)` with no upper cap, so touchpad animation duration also follows `animationTime`. The `MAX_FINE_FRAME_RESPONSE=0.8` frame cap remains, ensuring per-frame displacement stays bounded regardless of the time constant.

The `tailBudgetMs` result is guaranteed only for the executable workload covered by the regression suite: supported common refresh intervals, no more than one `50 ms` frame gap during the tail, and resumed display frames afterward. A longer or repeated main-thread stall provides no animation opportunity and therefore cannot have an unconditional wall-clock completion guarantee. Under the covered workload, common refresh rates follow the same wall-clock trajectory and a delayed frame carries undispatched work forward instead of jumping farther than the independent frame cap.

Completion follows the observed physical residual rather than a restartable timeout. Each observable-sized write has one bounded confirmation lease: while it is unacknowledged, no replacement write is issued and new input cannot reset the lease. A page that rejects or reverts the write therefore releases animation ownership instead of keeping a permanent rAF alive, while subpixel writes remain free to accumulate across browser quantization. Per-frame work remains constant with respect to wheel frequency and animation duration. Performance claims beyond these countable invariants require a release benchmark.

## Architecture invariants

- one executable registry and taxonomy;
- one permission source and generated usage projection;
- no panel-owned clock for work that must outlive the panel;
- no manual duplicate content-script or active-service inventory;
- no hidden network capability;
- no recurring work while a plugin is inactive;
- no generated file edited by hand;
- no roadmap or proposal used as runtime authority.

The current sequencing and unresolved migration work live in [`roadmap.md`](roadmap.md).
