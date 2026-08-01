---
type: reference
status: stable
audience: developer
owner: halo-architecture
last_reviewed: 2026-08-01
---

# HALO architecture

HALO is a SidePanel-first developer and productivity toolkit. This document owns durable module boundaries, registry semantics, state/lifecycle ownership, permissions, localization, and performance constraints.

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

## Registry, Taxonomy & SidePanel Ownership

- **Registry**: Executable source for identity, category, loading metadata, and permissions. Taxonomy provides virtual views (active, scripts, system).
- **SidePanel**: `src/entry/sidepanel.tsx` owns application composition, not plugin business logic. Shared error boundaries isolate tool failures.

## State, Background Work & Hover Zoom

- **State**: Persistent background work uses SW events, alarms, and lifecycle tokens. `useToolState` coordinates storage sync with bounded write queues.
- **Hover Zoom MSE**: Session creation returns `{ ready, dispose }` synchronously; retired sessions cannot clear newer video sources.

## Permissions, Localization & Performance

- **Permissions**: Declared by plugin metadata and compiled into usage maps; consume one permission source.
- **Localization**: Local plugin locale sources compile into generated runtime aggregates.
- **Performance**: Inactive plugins allocate 0 recurring work; SidePanel visibility pauses rendering/sampling.

### Smooth-scroll ownership

Input admission is owned by page content; displacement animation is owned by the shared engine:
- **Routing**: Top-level context only; descendant handlers get first refusal. Embedded app surfaces, editable controls, fullscreen content, and `hidden`/`clip` elements remain native.
- **Keyboard**: Arrow keys are capture-phase only after an animatable page route is admitted. Pointer/focus interaction with a media surface gives that surface arrow ownership until interaction moves outside, focus moves elsewhere, the media detaches, or the document lifecycle resets. Media presence, playback, and viewport size never imply arrow ownership. Space/PageUp/PageDown retain bubble-phase page refusal and discrete-jump semantics.
- **Depth Bound**: `MAX_SCROLL_ROUTE_ELEMENTS` bounds structural preflight at 65 elements.
- **Settings & Frame Envelope**: `HALO_SMOOTH_SCROLL_SETTINGS` in `storage.sync` distributes configuration. `SCROLL_LIMITS` owns frame bounds: max speed `6 CSS px/ms`, max frame displacement `100 CSS px`.
- **Time Envelope**: `tailBudgetMs()` returns `max(280, state.time + 32)`. `maxBacklogPx()` derives max capacity (at `animationTime=400`, `tailBudget=432`, `maxBacklog=2200`). Fine-mode time constant `max(8, animationTime * 0.03)` with `MAX_FINE_FRAME_RESPONSE=0.8`.

## Architecture invariants

- One executable registry and taxonomy; one permission source and generated projection.
- No panel-owned clock for background work; no manual duplicate content-script inventory.
- No hidden network capability; 0 recurring work for inactive plugins; no generated file edited manually.

Roadmap sequencing lives in [`roadmap.md`](roadmap.md).
