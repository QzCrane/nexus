---
type: reference
status: stable
audience: developer
owner: halo-architecture
last_reviewed: 2026-08-09
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
| `content-smooth-scroll.js` | top frame | `document_start` | top-document physical scroll input; child-frame scrolling remains native |
| `content-frame-tools.js` | all matching frames | `document_start` | minimal command bootstrap for Ruler, DOM Selector, and Annotate; heavy implementations are absent from the static startup graph |
| `tools/_frame-tools/runtime.js` | each frame only after explicit tool activation | on-demand ESM | packaged Ruler, DOM Selector, and Annotate implementation; loaded through the existing `tools/*` web-accessible resource boundary |
| `content-hover-zoom.js` | top frame | `document_idle` | light Hover Zoom settings/input/trigger host; high-frequency mouse/key listeners exist only while enabled and heavy preview code is absent from startup |
| `tools/_hover-zoom/runtime.js` | top document only after a valid preview intent | on-demand ESM | packaged Hover Zoom resolver/viewer/MSE/hotkey preview implementation; loaded through the existing `tools/*` web-accessible resource boundary |
| `content-clipboard.js` | all matching frames | `document_idle` | minimal copy capture host; copy listener follows Clipboard enablement |
| `background.js` | extension service worker | event-driven | lifecycle, context menus, user-script reconciliation, privileged browser operations |
| `sidepanel-init.js` | SidePanel document | pre-renderer | theme and scroll/input paint-critical initialization only |
| `sidepanel.js` | SidePanel document | ESM startup | application shell; tool-host infrastructure and tool panels remain physical lazy chunks |

Rules:

- `all_frames:true` is a semantic capability declaration, not a convenience flag. Only behavior that must work inside iframe documents may pay that cost.
- `document_start` is reserved for behavior that can lose correctness if it starts after early page/user input. Everything else moves to `document_idle` or explicit activation.
- An all-frame surface may not import unrelated tool/UI code. Cross-frame capability expansion requires an explicit manifest/test/architecture change.
- A static all-frame bootstrap may delegate to extension-owned packaged code only through a tested lazy boundary. A cold cleanup command must not instantiate or load a runtime that has never been activated.
- The static Hover Zoom host may own only lightweight settings, pointer/key state, resource-key matching, trigger validation, highlight behavior, and synchronous page-input ownership. Resolver/viewer/MSE/hotkey preview implementation must remain behind the packaged on-demand runtime boundary.
- A renderer `lazy(import())` boundary is only considered lazy when the production build emits physical ESM chunks. The generated loader owns one memoized import promise shared by hover preload and lazy rendering; application code must not inspect renderer-private fields. Production build failure is required if SidePanel splitting silently collapses.
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
- **SidePanel**: `src/entry/sidepanel.tsx` owns application composition, not plugin business logic. Source and type contracts remain React-compatible, while the SidePanel-owned production graph resolves the React/ReactDOM entrypoints to pinned `preact@10.29.7` compat exports inside `build.ts`; no background or content-script graph receives those aliases. The package is MIT licensed, has no runtime dependencies or network behavior, and is owned only by `@nexus/extension-halo`. Shared error boundaries isolate tool failures. `LauncherToolPage` itself is lazy, so tool-host infrastructure does not enter the Home cold-start closure before the first tool activation.
- **Storage-change delivery**: `kernel/core/storage-change-bus.ts` owns the single physical `chrome.storage.onChanged` listener in a SidePanel JS context and multiplexes events to domain authorities. A domain may subscribe to the bus, but may not register a parallel direct Chrome listener merely to filter a different key.
- **Runtime status**: `ActiveServicesProvider` owns the SidePanel status projection for Clipboard, Hover Zoom, Smooth Scroll, and SaaT status inputs. `system/userscripts/storage-authority.ts` separately owns the canonical `halo_userscripts` persistence projection, including schema validation, hydration/event ordering, and snapshot identity. Both consume the shared storage-change bus, so this domain split does not create a second physical Chrome listener. `EngineStatusProvider` remains a pure projection and creates no storage authority.
- **UserScripts persistence projection**: all SidePanel consumers of `halo_userscripts` share the system-layer external store. Missing storage uses the historical default-on state; a read failure or malformed persisted row fails the entire snapshot closed. The authority preserves validated extensible metadata so a read/export/import cycle cannot silently convert a registry-managed script into a user-owned script.
- **Initialization phases**: settings/theme hydration is mount-scoped and independent of module-manager readiness. Open-tool restoration waits for the hydrated module installation set. Module readiness must not retrigger settings I/O.

## State, Background Work & User-script registration

- **State**: Persistent background work uses SW events, alarms, and lifecycle tokens. `useToolState` coordinates storage sync with bounded write queues.
- **Event-driven status**: a relevant storage-change payload is delivered once by the SidePanel storage-change bus and updates the owning in-memory projection directly; it must not trigger a second full read of the same keys. Initial async hydration cannot overwrite a newer event-owned field.
- **Persistent browser registration**: `chrome.userScripts` and dynamically registered content scripts are browser-owned registration state, not service-worker heap state. Ordinary MV3 worker wake must not execute `storage.get -> getRegistered -> unregister -> register` as startup work.
- **Reconciliation triggers**: `runtime.onInstalled` restores/realigns browser registration after install/update; subsequent `halo_userscripts` or `halo_saat_scripts` storage authority changes request reconciliation. Concurrent requests serialize and collapse to at most one trailing full reconcile.
- **Dynamic content-script persistence**: HALO sets `persistAcrossSessions:true` explicitly instead of relying on the API default.

## Active feature lifecycle

- **Hover Zoom MSE**: Session creation returns `{ ready, dispose }` synchronously; retired sessions cannot clear newer video sources.
- **Hover Zoom input**: when enabled, the static `document_idle` host owns only light settings hydration, pointer/key tracking, exact trigger matching/highlight, and synchronous Alt ownership. The first still-valid preview intent imports one document-local `tools/_hover-zoom/runtime.js` promise and then invokes the resolver/viewer implementation. Failed imports clear the promise so a later real intent can retry. Key release, pointer retirement, disablement, or settings-authority replacement invalidates the current preview generation so a late module load cannot resurrect stale UI. When disabled, Hover Zoom removes its mouse/key listeners, pending trigger timer, viewer ownership, pending preview intent, and pending preload; only the low-frequency settings subscription remains for re-enablement.
- **Frame tools**: every matching frame retains only the minimal `content-frame-tools.js` command bootstrap. The first Ruler, DOM Selector, or Annotate activation imports `tools/_frame-tools/runtime.js` through `chrome.runtime.getURL()` and caches that document-local module promise. A failed import clears the promise so a later explicit activation can retry. STOP/CANCEL before first activation is a zero-work no-op and must not load the runtime. The static bootstrap preserves existing cross-origin iframe coverage without widening host permissions.
- **Timer**: persistent authority is `elapsed + startedAt`; rAF updates only the visible time projection. A bounded wall-clock deadline watcher rechecks at most once per second so clock jumps cannot strand or prematurely complete a countdown; persistent Timer state is not rewritten on those checks.
- **Pomodoro**: persistent authority is a paused `remaining` value or running absolute `endsAt`; one 1Hz owner updates only ephemeral display time until the latest wall-clock sample reaches the deadline, then commits the phase boundary exactly once. There is no independent one-shot completion timeout.
- **TTS**: speech state follows `SpeechSynthesisUtterance` lifecycle events; no periodic `speechSynthesis` polling. The tool panel owns its browser speech lifecycle and cancels any surviving utterance when the panel unmounts, so navigation cannot orphan speech without controls.
- **TOTP**: the UI may update remaining seconds at 1Hz, but HMAC output is cached for each entry/counter epoch and recomputed only when the counter or code-defining parameters change. Epoch recomputation remains sequential so account count cannot create an unbounded WebCrypto burst.

## Permissions, Localization & Performance

- **Permissions**: Declared by plugin metadata and compiled into usage maps; consume one permission source.
- **Unavailable feature admission**: a plugin whose executable registry status is `coming` cannot own background/page behavior by default. Clipboard capture is fail-closed on fresh install, missing/malformed settings, and storage failure; only an explicit persisted enablement may attach its all-frame `copy` listener.
- **Localization**: Local plugin locale sources compile into generated runtime aggregates.
- **Performance**: Inactive plugins allocate 0 recurring work. Disabled high-frequency features detach their hot listeners. SidePanel hidden/inactive surfaces must not poll. Browser-owned work started by a tool panel must either transfer to another explicit owner or dispose when that panel unmounts.
- **Build evidence**: production build derives all-frame/top-frame `document_start` and `document_idle` membership from the source manifest, then charges each declared JS entry by its complete static esbuild closure. SidePanel static startup closure, Background worker bundle, and eventual lazy bytes remain separately measured. Packaged on-demand modules that are not declared in `content_scripts` are not startup bytes.
- **Audited 2026-08-13 production ceilings**: `background <= 24KiB`, `all-frame@document_start <= 1KiB`, `top-frame@document_start <= 26KiB`, `all-frame@document_idle <= 2KiB`, `top-frame@document_idle <= 10KiB`, `SidePanel startup <= 32KiB`. `build.ts` fails if any audited startup surface crosses its current KiB bucket, if the SidePanel lacks Preact inputs, or if React, ReactDOM, or Scheduler runtime inputs survive. An intentional increase requires an explicit architecture and budget update.
- **Measured Windows startup surfaces (2026-08-13)**: the integrated module-lifecycle and storage-authority candidate reports `all-frame@document_start = 1KiB`, `top-frame@document_start = 26KiB`, `all-frame@document_idle = 2KiB`, `top-frame@document_idle = 10KiB`, `SidePanel startup = 32KiB`, and `background = 24KiB`. SidePanel renderer substitution reduces its static startup closure from 165KiB to 32KiB (about 80.6%) while preserving the existing lazy feature chunks. The Background increase is the explicit cost of one registry-derived module lifecycle authority and one shared User Scripts storage-change authority; it is not charged to content startup. The static Frame Tools host remains 1KiB with its 7KiB implementation paid only after explicit activation, and the static Hover Zoom host remains 9KiB with its 48KiB runtime paid only after a valid preview intent. Future budget changes require repeatable exact-head measurements; OS parity is additionally required only when the measurement or changed mechanism crosses a platform-sensitive boundary.
- **Cross-origin and lazy-runtime browser evidence**: the production Chromium gate loads HALO on a top document at `127.0.0.1` with a child frame at `127.0.0.2`, proves a cold Ruler CANCEL leaves the heavy Frame Tools runtime unloaded, then proves one tab-wide START lazy-loads the packaged runtime and creates the Ruler overlay in both origins before CANCEL removes both. The same browser gate proves a cold Hover Zoom page has no Viewer DOM, then preserves pointer-before-Alt semantics: the first valid Alt gesture loads the packaged preview runtime, resolves and displays the image, and key release retires the viewer. Smooth Scroll keyboard ownership remains covered in the same Chromium installation.
- Performance budgets are anchored to measured production artifacts rather than source-line counts, total extension size, or bundle-count heuristics.

### Smooth-scroll ownership

Smooth Scroll is physically and semantically top-document-only: its static content entry is not injected into child frames, and child-frame scrolling remains browser/page-native. Displacement animation is owned by the shared engine.
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
- One physical SidePanel `chrome.storage.onChanged` listener per JS context; domain authorities consume the shared event bus and may not create duplicate direct status listeners/read loops.
- `halo_userscripts` has one canonical SidePanel persistence authority; narrower Launcher/ActiveServices/full-panel views are selectors/materializations, not independent Chrome-storage owners.
- No panel-owned clock for background work; no manual duplicate content-script inventory.
- Browser-owned work cannot outlive an unmounted panel unless ownership is explicitly transferred and recoverable.
- No hidden network capability; 0 recurring work for inactive plugins; no generated file edited manually.
- No widening a content surface from top-frame to all-frame or from idle to start without a semantic requirement and regression-test update.
- No heavy Ruler, DOM Selector, or Annotate implementation in the static all-frame startup closure; the Frame Tools bootstrap may load that implementation only after an explicit activation command.
- No cold frame-tool cleanup command may load an uninitialized heavy runtime.
- No heavy Hover Zoom resolver, viewer, MSE, or preview hotkey implementation in the static top-frame `document_idle` closure; it may load only after a valid preview intent.
- No stale Hover Zoom input/settings generation may resurrect UI after its lazy runtime finishes loading.
- No production lazy panel boundary may resolve back into the SidePanel startup bundle; physical code splitting is a build invariant.
- No performance conclusion based only on total extension bytes: startup closure and eventual feature bytes are measured separately.
- No silent growth across the audited production startup ceilings.

Roadmap sequencing lives in [`roadmap.md`](roadmap.md).
