---
type: reference
status: stable
audience: developer
owner: halo-architecture
last_reviewed: 2026-07-20
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
- animations respect user settings and reduced-motion preferences;
- a tool failure is isolated by the shared error boundary and does not destroy the shell;
- theme or dark-mode behavior embedded in Settings is an internal feature unless it satisfies the complete plugin contract.

## State and background work

Panel-local state may remain in the panel. Work that must continue after panel closure requires an explicit Background owner, persisted state model, wake/recovery behavior, and tests for service-worker suspension.

Do not keep a feature alive through unbounded intervals, hidden panels, or duplicated storage listeners. Prefer browser events, alarms, and narrowly owned lifecycle tokens.

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