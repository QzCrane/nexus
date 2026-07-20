---
type: reference
status: draft
audience: developer
last_reviewed: 2026-07-20
---

# HALO architecture and roadmap

HALO is a SidePanel-first developer and productivity toolkit. This file is the application owner for module boundaries, registry semantics, and current sequencing. Executable registry data, source, tests, and release gates remain the implementation truth.

Local-first is the default. A feature that uses synchronization, external APIs, or cloud storage must be a separate explicit capability with narrow permissions, failure semantics, and disclosure; it must not be hidden behind a blanket “zero network” claim.

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
- a panel component does not become the background authority for work that must survive panel closure.

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

Files are split by responsibility, not by an absolute line quota. Large files are review signals; a split is valid only when it creates an explicit boundary rather than hiding one workflow across fragments.

### Naming

- plugin ID and directory: kebab-case;
- storage keys: owned, namespaced, and versioned;
- messages: typed contracts rather than string lists copied across listeners;
- React components may use PascalCase when required by the local convention;
- hooks follow the existing `useCamelCase` convention.

## Registry and taxonomy

The registry is the source of plugin identity, type, category, loading metadata, and required permissions. Generated projections may include plugin lists and typed helpers, but no UI or background module maintains a second manual inventory.

Taxonomy contains virtual views such as active, scripts, and system plus functional categories. Sorting and labels originate from the taxonomy/registry boundary and are translated at the UI edge.

A plugin count is a generated observation. Documentation does not freeze a total that can drift after the next registry change.

## SidePanel ownership

`src/entry/sidepanel.tsx` owns application composition. It does not own plugin business logic.

Entry routes may include the browser action, context menus, and configured commands. Each route resolves a typed destination, reports restricted browser pages as bounded errors, and avoids duplicate state managers.

### UI system

- shared design tokens own color, spacing, surface, focus, and motion vocabulary;
- user-visible text and accessible names use canonical locale keys;
- animations respect the user setting and reduced-motion environment;
- a tool failure is isolated by the shared error boundary and does not destroy the SidePanel shell;
- theme or dark-mode behavior embedded in Settings is an internal feature unless it satisfies the complete plugin contract.

## State and background work

Panel-local state may remain in the panel. Work that must continue after panel closure requires an explicit background owner, persisted state model, wake/recovery behavior, and tests for service-worker suspension.

Do not keep a feature alive through unbounded intervals, hidden panels, or duplicated storage listeners. Prefer browser events, alarms, and narrowly owned lifecycle tokens.

## Permissions

Permissions are declared by the plugin's executable metadata and compiled into a reviewable usage map. A new permission must identify:

- the exact plugin and user action that needs it;
- whether it is install-time, optional, or runtime-granted;
- the data and browser surface it exposes;
- the behavior when unavailable or revoked;
- tests and public disclosure where applicable.

Settings, the permission manager, and store copy consume the same permission source rather than maintaining parallel lists.

## i18n

Plugin locale sources remain local to the plugin and compile into generated runtime aggregates. Canonical keys are flat at the source boundary and are hydrated only by the maintained generator.

A plugin is incomplete when its name, description, primary actions, errors, or accessible labels are missing from required locales. Generated locale files are not edited manually.

## Performance boundaries

- inactive plugins allocate no recurring work;
- SidePanel visibility pauses optional rendering and sampling;
- registry generation occurs at build time rather than by runtime directory scans;
- large data operations use bounded batches and cancellation;
- hot input paths avoid repeated parsing, allocation, layout reads, or storage writes;
- performance claims require measured startup, interaction, memory, and background-wake evidence.

“Zero allocation,” “zero CPU,” and fixed speedup factors are not documentation guarantees unless a release benchmark defines the workload and proves the claim.

## Current engineering priorities

### P0: ownership closure

- finish taxonomy and registry as the sole plugin inventory;
- generate and verify the permission-usage map from plugin metadata;
- remove remaining manual content-script and active-service registration lists;
- ensure background-capable tools recover after service-worker suspension.

### P1: release readiness

- add HALO product README, privacy policy, store listings, locale assets, and release checks before public distribution;
- verify every shipped plugin's permissions, data retention, import/export behavior, and error isolation;
- replace stale tool/version counts in public documents with generated evidence.

### P2: product workstreams

- complete prioritized existing workstreams before adding broad new categories;
- treat OCR, AI, cloud backup, translation providers, external validators, and remote APIs as separately reviewed network capabilities;
- require acceptance criteria and lifecycle tests in each workstream plan.

## Open architectural problems

### Persistent background timers

Pomodoro, countdown, and similar tools need a Background-owned deadline model, browser alarm recovery, persisted state, and a projection into the SidePanel. A mounted React component is not the clock authority.

### Generated Content entry

A plugin requiring Content execution must be discoverable from its manifest and generated into the Content entry. Manual imports are a temporary migration state and must fail a registry verification check when they drift.

### Active-service projection

The active-service UI must derive from plugin lifecycle state rather than a manually maintained storage-key list. Each service exposes an owned status contract and disposer.

## Research and workstream documents

- [Market hypotheses](docs/research.md)
- [Feature gap backlog](docs/feature-gap-analysis.md)
- [Hover Zoom workstream](docs/plan-hover-zoom-v2.md)
- [Danmaku proposal](docs/plan-danmaku.md)
- [Repository documentation map](../../docs/documentation-index.md)

These documents may propose features or preserve dated evidence. They do not override this owner or prove completion.

## Completion rule

A HALO capability closes only when metadata, permissions, implementation, lifecycle, state recovery, i18n, tests, documentation, and release projection agree. A version heading, checklist mark, or tool-count claim is insufficient.