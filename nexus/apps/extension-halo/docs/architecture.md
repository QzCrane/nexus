---
type: reference
status: stable
audience: developer
owner: halo-architecture
last_reviewed: 2026-08-08
---

# HALO architecture

HALO is a SidePanel-first developer and productivity toolkit. This document owns durable module boundaries, registry semantics, state/lifecycle ownership, permissions, localization, and performance constraints.

## Runtime surfaces

```text
src/
├─ entry/                  physically separated browser/runtime surfaces
├─ components/             shell, navigation, shared interaction
├─ kernel/                 registry, taxonomy, managers, shared services
├─ tools/<id>/             user-invoked panel tools
├─ scripts/<id>/           user-controlled script capabilities
├─ system/<id>/            settings, permissions, module management
└─ i18n/                   locale sources and generated aggregates
```

HALO content code is partitioned by **frame scope × lifecycle phase × capability ownership**. A source-level module boundary is not sufficient: the production artifact must preserve the same physical boundary.

| Production entry | Frame scope | Phase | Ownership |
| --- | --- | --- | --- |
| `content.js` | top frame | `document_start` | minimal generic/status router and top-document commands |
| `content-smooth-scroll.js` | all matching frames | `document_start` | frame-local physical scroll input; required before early user input |
| `content-frame-tools.js` | all matching frames | `document_start` | dormant message host for Ruler, DOM Selector, and Annotate; no recurring work at module load |
| `content-hover-zoom.js` | top frame | `document_idle` | Hover Zoom; high-frequency mouse/key listeners exist only while enabled |
| `content-clipboard.js` | all matching frames | `document_idle` | minimal copy capture host; copy listener follows Clipboard enablement |
| `background.js` | extension service worker | event-driven | lifecycle, context menus, SaaT synchronization, privileged browser operations |
| `sidepanel-init.js` | SidePanel document | pre-React | theme and scroll/input paint-critical initialization only |
| `sidepanel.js` | SidePanel document | ESM startup | application shell; tool panels remain physical lazy chunks |

Rules:

- `all_frames:true` is a semantic capability declaration, not a convenience flag. Only behavior that must work inside iframe documents may pay that cost.
- `document_start` is reserved for behavior that can lose correctness if it starts after early page/user input. Everything else moves to `document_idle` or explicit activation.
- An all-frame surface may not import unrelated tool/UI code. Cross-frame capability expansion requires an explicit manifest/test/architecture change.
- `React.lazy(import())` is only considered lazy when the production build emits physical ESM chunks. Production build failure is required if SidePanel splitting silently collapses.
- Production measurement distinguishes entry bytes, static startup closure, and total eventual lazy bytes. These quantities are not interchangeable.

- `tool`, `script`, and `system` are distinct plugin types with explicit boundaries.
- Panel components do not act as Background authorities for background tasks.

## Plugin contract & Naming

```text
tools/<id>/
├─ manifest.json | index.ts | types.ts | core.ts | panel.tsx | locales/
```
- Plugin ID & Directory: `kebab-case`
- Storage Keys: Owned, namespaced, versioned
- Messages: Typed contracts; React Components: `PascalCase`; Hooks: `useCamelCase`
- Background/performance provenance in plugin manifests must identify the live runtime owner after a listener or worker is moved; stale source paths are an architecture defect because resource-impact attribution becomes false.

## Registry, Taxonomy & SidePanel Ownership

- **Registry**: Executable source for identity, category, loading metadata, permissions, and resource-impact provenance. Taxonomy provides virtual views (active, scripts, system).
- **SidePanel**: `src/entry/sidepanel.tsx` owns application composition, not plugin business logic. Shared error boundaries isolate tool failures.
- **Runtime status**: `ActiveServicesProvider` is the SidePanel storage authority for service/engine activation. It performs one initial local+sync hydration and one incremental `storage.onChanged` subscription; `EngineStatusProvider` is a pure projection and does not create a second Chrome-storage authority.
- **Initialization phases**: settings/theme hydration is mount-scoped and independent of module-manager readiness. Open-tool restoration waits for the hydrated module installation set. Module readiness must not retrigger settings I/O.

## State, Background Work & Hover Zoom

- **State**: Persistent background work uses SW events, alarms, and lifecycle tokens. `useToolState` coordinates storage sync with bounded write queues.
- **Event-driven status**: a relevant `storage.onChanged` payload updates the in-memory SidePanel status projection directly; it must not trigger a second full read of the same keys. Initial async hydration cannot overwrite a newer event-owned field.
- **Hover Zoom MSE**: Session creation returns `{ ready, dispose }` synchronously; retired sessions cannot clear newer video sources.
- **Hover Zoom input**: when disabled, Hover Zoom removes its mouse/key listeners, pending trigger timer, viewer ownership, and pending preload. A low-frequency settings subscription may remain to detect re-enablement.

## Permissions, Localization & Performance

- **Permissions**: Declared by plugin metadata and compiled into usage maps; consume one permission source.
- **Localization**: Local plugin locale sources compile into generated runtime aggregates.
- **Performance**: Inactive plugins allocate 0 recurring work. Disabled high-frequency features detach their hot listeners. SidePanel hidden/inactive surfaces must not poll.
- **Build evidence**: production build reports all-frame/top-frame `document_start`, all-frame/top-frame `document_idle`, SidePanel static startup closure, and eventual lazy chunk bytes. Performance budgets are anchored to measured production artifacts rather than arbitrary source-line or bundle-count heuristics.

### Smooth-scroll ownership

Input admission is owned by each matching frame's page-local content context; displacement animation is owned by the shared engine:
- **Routing**: Within a frame, the admitted page scroll context owns HALO displacement only after descendant/native handlers receive their refusal opportunity. Embedded app surfaces, editable controls, fullscreen content, and `hidden`/`clip` elements remain native.
- **Keyboard**: Arrow keys are capture-phase only after an animatable page route is admitted. Pointer/focus interaction with a media surface gives that surface arrow ownership until interaction moves outside, focus moves elsewhere, the media detaches, or the document lifecycle resets. Media presence, playback, and viewport size never imply arrow ownership. Space/PageUp/PageDown retain bubble-phase page refusal and discrete-jump semantics.
- **Depth Bound**: `MAX_SCROLL_ROUTE_ELEMENTS` bounds structural preflight at 65 elements.
- **Settings & Frame Envelope**: `HALO_SMOOTH_SCROLL_SETTINGS` in `storage.sync` distributes configuration. `SCROLL_LIMITS` owns frame bounds: max speed `6 CSS px/ms`, max frame displacement `100 CSS px`.
- **Time Envelope**: `tailBudgetMs()` returns `max(280, state.time + 32)`. `maxBacklogPx()` derives max capacity (at `animationTime=400`, `tailBudget=432`, `maxBacklog=2200`). Fine-mode time constant `max(8, animationTime * 0.03)` with `MAX_FINE_FRAME_RESPONSE=0.8`.

## Architecture invariants

- One executable registry and taxonomy; one permission source and generated projection.
- One SidePanel storage authority for runtime/engine status; no duplicate status listener/read loops.
- No panel-owned clock for background work; no manual duplicate content-script inventory.
- No hidden network capability; 0 recurring work for inactive plugins; no generated file edited manually.
- No widening a content surface from top-frame to all-frame or from idle to start without a semantic requirement and regression-test update.
- No production `React.lazy` that resolves back into the SidePanel startup bundle; physical code splitting is a build invariant.
- No performance conclusion based only on total extension bytes: startup closure and eventual feature bytes are measured separately.

Roadmap sequencing lives in [`roadmap.md`](roadmap.md).
