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
| `content-smooth-scroll.js` | all matching frames | `document_start` | top-document physical scroll input; child-frame initialization exits before taking input ownership |
| `content-frame-tools.js` | all matching frames | `document_start` | dormant message host for Ruler, DOM Selector, and Annotate; no recurring work at module load |
| `content-hover-zoom.js` | top frame | `document_idle` | Hover Zoom; high-frequency mouse/key listeners exist only while enabled |
| `content-clipboard.js` | all matching frames | `document_idle` | minimal copy capture host; copy listener follows Clipboard enablement |
| `background.js` | extension service worker | event-driven | lifecycle, context menus, user-script reconciliation, privileged browser operations |
| `sidepanel-init.js` | SidePanel document | pre-React | theme and scroll/input paint-critical initialization only |
| `sidepanel.js` | SidePanel document | ESM startup | application shell; tool-host infrastructure and tool panels remain physical lazy chunks |

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
- **Install-time script projection**: the registry generator emits `public/script-plugin-runtime.json` containing only `{ id, pluginType, script }` for script-capable plugins. `background.js` must not import the full UI `TOOL_REGISTRY` just to perform `onInstalled` SaaT synchronization. The local JSON is fetched and runtime-validated only during install/update reconciliation.
- **SidePanel**: `src/entry/sidepanel.tsx` owns application composition, not plugin business logic. Shared error boundaries isolate tool failures. `LauncherToolPage` itself is lazy, so tool-host infrastructure does not enter the Home cold-start closure before the first tool activation.
- **Runtime status**: `ActiveServicesProvider` is the SidePanel storage authority for service/engine activation. It performs one initial local+sync hydration and one incremental `storage.onChanged` subscription; `EngineStatusProvider` is a pure projection and does not create a second Chrome-storage authority.
- **Initialization phases**: settings/theme hydration is mount-scoped and independent of module-manager readiness. Open-tool restoration waits for the hydrated module installation set. Module readiness must not retrigger settings I/O.

## State, Background Work & User-script registration

- **State**: Persistent background work uses SW events, alarms, and lifecycle tokens. `useToolState` coordinates storage sync with bounded write queues.
- **Event-driven status**: a relevant `storage.onChanged` payload updates the in-memory SidePanel status projection directly; it must not trigger a second full read of the same keys. Initial async hydration cannot overwrite a newer event-owned field.
- **Persistent browser registration**: `chrome.userScripts` and dynamically registered content scripts are browser-owned registration state, not service-worker heap state. Ordinary MV3 worker wake must not execute `storage.get -> getRegistered -> unregister -> register` as startup work.
- **Reconciliation triggers**: `runtime.onInstalled` restores/realigns browser registration after install/update; subsequent `halo_userscripts` or `halo_saat_scripts` storage authority changes request reconciliation. Concurrent requests serialize and collapse to at most one trailing full reconcile.
- **Dynamic content-script persistence**: HALO sets `persistAcrossSessions:true` explicitly instead of relying on the API default.

## Active feature lifecycle

- **Hover Zoom MSE**: Session creation returns `{ ready, dispose }` synchronously; retired sessions cannot clear newer video sources.
- **Hover Zoom input**: when disabled, Hover Zoom removes its mouse/key listeners, pending trigger timer, viewer ownership, and pending preload. A low-frequency settings subscription may remain to detect re-enablement.
- **Timer**: persistent authority is `elapsed + startedAt`; rAF updates only the visible time projection. A bounded wall-clock deadline watcher rechecks at most once per second so clock jumps cannot strand or prematurely complete a countdown; persistent Timer state is not rewritten on those checks.
- **Pomodoro**: persistent authority is a paused `remaining` value or running absolute `endsAt`; one 1Hz owner updates only ephemeral display time until the latest wall-clock sample reaches the deadline, then commits the phase boundary exactly once. There is no independent one-shot completion timeout.
- **TTS**: speech state follows `SpeechSynthesisUtterance` lifecycle events; no periodic `speechSynthesis` polling. The tool panel owns its browser speech lifecycle and cancels any surviving utterance when the panel unmounts, so navigation cannot orphan speech without controls.
- **TOTP**: the UI may update remaining seconds at 1Hz, but HMAC output is cached for each entry/counter epoch and recomputed only when the counter or code-defining parameters change. Epoch recomputation remains sequential so account count cannot create an unbounded WebCrypto burst.

## Permissions, Localization & Performance

- **Permissions**: Declared by plugin metadata and compiled into usage maps; consume one permission source.
- **Localization**: Local plugin locale sources compile into generated runtime aggregates.
- **Performance**: Inactive plugins allocate 0 recurring work. Disabled high-frequency features detach their hot listeners. SidePanel hidden/inactive surfaces must not poll. Browser-owned work started by a tool panel must either transfer to another explicit owner or dispose when that panel unmounts.
- **Build evidence**: production build reports all-frame/top-frame `document_start`, all-frame/top-frame `document_idle`, SidePanel static startup closure, Background worker bundle, and eventual lazy chunk bytes.
- **Audited 2026-08-08 production ceilings**: `background <= 14KiB`, `all-frame@document_start <= 31KiB`, `top-frame@document_start <= 32KiB`, `all-frame@document_idle <= 2KiB`, `top-frame@document_idle <= 55KiB`, `SidePanel startup <= 165KiB`. `build.ts` fails if any audited startup surface crosses its current KiB bucket. An intentional increase requires an explicit architecture and budget update.
- Performance budgets are anchored to measured production artifacts rather than source-line counts, total extension size, or bundle-count heuristics.

### Smooth-scroll ownership

The current static manifest distributes the Smooth Scroll entry to every matching frame, but runtime input admission is top-document-only: child-frame initialization exits before registering input ownership. Displacement animation is owned by the shared engine.
- **Routing**: The admitted top-document scroll context owns HALO displacement only after native/page handlers receive their refusal opportunity. Embedded app surfaces, editable controls, fullscreen content, and `hidden`/`clip` elements remain native.
- **Keyboard admission**: A capture observer is registered synchronously at `document_start` but remains inert until settings hydration proves the feature enabled. For each trusted candidate, HALO captures its media-state evidence once and appends same-event document/window finalizers; it does not decide ownership from media presence, geometry, prior pointer interaction, or focus history.
- **Website-first ownership**: `defaultPrevented`, same-dispatch `cancelBubble`, or a synchronous media-state mutation are website ownership evidence. HALO yields without calling `stopPropagation()` or `stopImmediatePropagation()`. A site that stops propagation but leaves the default action untouched therefore still owns the event.
- **Tail lifetime**: same-event finalizers remain alive through browser propagation. Normal bubble settlement executes first; a 0ms macrotask only removes an orphaned tail when propagation never reaches it. The cleanup task never converts a truncated event into delayed HALO execution. Microtask tail cleanup is forbidden because it can run before a later window-bubble finalizer.
- **Repeat ownership**: Keyboard repeat uses its own canonical clock and never reuses wheel acceleration state. Delivery-frequency differences are coalesced after the browser's first repeat arrives; the OS-owned first-repeat delay is preserved and is never synthetically backfilled.
- **Depth Bound**: `MAX_SCROLL_ROUTE_ELEMENTS` bounds structural preflight at 65 elements.
- **Settings & Frame Envelope**: `HALO_SMOOTH_SCROLL_SETTINGS` in `storage.sync` distributes configuration. `SCROLL_LIMITS` owns frame bounds: max speed `6 CSS px/ms`, max frame displacement `100 CSS px`.
- **Time Envelope**: `tailBudgetMs()` returns `max(280, state.time + 32)`. `maxBacklogPx()` derives max capacity (at `animationTime=400`, `tailBudget=432`, `maxBacklog=2200`). Fine-mode time constant `max(8, animationTime * 0.03)` with `MAX_FINE_FRAME_RESPONSE=0.8`.

## Architecture invariants

- One executable registry and taxonomy; one permission source and generated projection.
- Full UI registry metadata does not enter the ordinary service-worker wake graph for install-only script synchronization.
- Browser-persistent user/content-script registrations are never destroyed and rebuilt solely because the MV3 worker woke up.
- One SidePanel storage authority for runtime/engine status; no duplicate status listener/read loops.
- No panel-owned clock for background work; no manual duplicate content-script inventory.
- Browser-owned work cannot outlive an unmounted panel unless ownership is explicitly transferred and recoverable.
- No hidden network capability; 0 recurring work for inactive plugins; no generated file edited manually.
- No widening a content surface from top-frame to all-frame or from idle to start without a semantic requirement and regression-test update.
- No production `React.lazy` that resolves back into the SidePanel startup bundle; physical code splitting is a build invariant.
- No performance conclusion based only on total extension bytes: startup closure and eventual feature bytes are measured separately.
- No silent growth across the audited production startup ceilings.

Roadmap sequencing lives in [`roadmap.md`](roadmap.md).
