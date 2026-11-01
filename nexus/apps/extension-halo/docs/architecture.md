---
type: reference
status: stable
audience: developer
owner: halo-architecture
last_reviewed: 2026-11-01
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
- **Install-time script projection**: the registry generator owns the versioned `public/script-plugin-runtime.json` projection containing only `{ id, pluginType, script }` for script-capable plugins. Generator `--check` must compare that exact projection in every clean clone and supported OS; never edit it by hand. `background.js` must not import the full UI `TOOL_REGISTRY` just to perform `onInstalled` SaaT synchronization. The local JSON is fetched and runtime-validated only during install/update reconciliation.
- **SidePanel**: `src/entry/sidepanel.tsx` owns application composition, not plugin business logic. Source and type contracts remain React-compatible, while the SidePanel-owned production graph resolves the React/ReactDOM entrypoints to pinned `preact@10.29.7` compat exports inside `build.ts`; no background or content-script graph receives those aliases. The package is MIT licensed, has no runtime dependencies or network behavior, and is owned only by `@nexus/extension-halo`. Shared error boundaries isolate tool failures. `LauncherToolPage` itself is lazy, so tool-host infrastructure does not enter the Home cold-start closure before the first tool activation.
- **Storage-change delivery**: `kernel/core/storage-change-bus.ts` owns the single physical `chrome.storage.onChanged` listener in a SidePanel JS context and multiplexes events to domain authorities. A domain may subscribe to the bus, but may not register a parallel direct Chrome listener merely to filter a different key.
- **Runtime status**: `ActiveServicesProvider` owns the SidePanel status projection for Clipboard, Hover Zoom, Smooth Scroll, and SaaT status inputs. `system/userscripts/storage-authority.ts` separately owns the canonical `halo_userscripts` persistence projection, including schema validation, hydration/event ordering, and snapshot identity. Both consume the shared storage-change bus, so this domain split does not create a second physical Chrome listener. `EngineStatusProvider` remains a pure projection and creates no storage authority.
- **UserScripts persistence projection**: all SidePanel consumers of `halo_userscripts` share the system-layer external store. Missing storage uses the historical default-on state; a read failure or malformed persisted row fails the entire snapshot closed. The authority preserves validated extensible metadata so a read/export/import cycle cannot silently convert a registry-managed script into a user-owned script.
- **Initialization phases**: settings/theme hydration is mount-scoped and independent of module-manager readiness. Open-tool restoration waits for the hydrated bundled-module enablement set. Module readiness must not retrigger settings I/O.

## System-layer plugins

A `system` plugin is a surface over an authority that already exists for the whole extension. It renders that authority and may request a change; it does not become a second owner of it.

| Plugin | Renders | Must not do |
| --- | --- | --- |
| `system/settings` | appearance/interface settings over the kernel settings authority, plus the local diagnostic export gesture | hold a second settings copy, or report an unconfirmed save as saved |
| `system/permissions` | per-capability request UI over `chrome.permissions` | persist a copy of a browser permission decision |
| `system/module-store` | enable/disable view over packaged modules and user scripts | install, download or replace code; present bundled bytes as a download size |
| `system/extension-manager` | other installed extensions and their user-assigned groups | call `chrome.management` before `management` is granted, or show an empty list in place of denial |
| `system/resource-monitor` | the declared-versus-observed impact inventory | present declared provenance as measured CPU or memory |
| `system/userscripts` | the canonical `halo_userscripts` projection | be re-read by a second SidePanel store |

- **Resource Monitor honesty**: rows come from the registry's declared background profiles (`BACKGROUND_PROFILES_MAP` / `BACKGROUND_PLUGIN_IDS`) plus the `ActiveServicesProvider` status projection. A row exists only because a live owner declares it, so an inactive mechanism is absent rather than listed as zero. Mechanism, frequency and impact level are declarations; the only observed claim on the panel is whether the owner is running now. No row may display a percentage, a byte figure or a CPU time that no owner measured.
- **Extension Manager permission proof**: `chrome.permissions.contains({ permissions: ['management'] })` gates the panel before any read. Denial produces a request action, not an empty result, and the group filter stays inert until the grant exists. Group assignments persist through the kernel ledger and register a `storage-health` owner, so an unconfirmed group write surfaces as uncertainty instead of a silently lost assignment.
- **Permissions panel**: browser state is the sole authority on every mount, because a persisted mirror can only go stale between a browser change and the next mount. A grant or revocation performed outside HALO is therefore reflected on the next read without reconciliation code.
- **Settings diagnostics**: HALO assembles its bundle inside the SidePanel through `buildLocalDiagnosticBundle` with three owner facts (`activeServiceCount`, `backgroundMechanismCount`, `settingsSurfaceActive`) and a bounded event buffer, then downloads it. There is no background collection port in HALO, and the surface states that the export stays local. The shared shape, redaction and token rules belong to `@nexus/kernel` diagnostics, not to this panel.

## State, Background Work & User-script registration

- **State**: Persistent background work uses SW events, alarms, and lifecycle tokens. `useToolState` coordinates storage sync through one ledger-backed, bounded latest-intent queue. Complex values and finite enums carry a domain `ToolStateCodec`; an invalid persisted value stays untouched and produces an explicit export/replace recovery surface instead of silently becoming a default. Quota admission uses the browser-reported storage-area limit and retains shared reserve rather than treating item counts as byte budgets.
- **Sensitive state**: API request bodies, authorization material, TOTP secrets and other sensitive drafts remain memory-only by default. `useSensitiveVaultState` moves the complete domain value into the extension-origin IndexedDB vault only after an explicit user save, verifies the committed value by readback, and requires a separately confirmed deletion of a legacy Chrome-storage copy. The vault narrows extension-context exposure; it is not encryption-at-rest or protection from a compromised extension origin.
- **Event-driven status**: a relevant storage-change payload is delivered once by the SidePanel storage-change bus and updates the owning in-memory projection directly; it must not trigger a second full read of the same keys. Initial async hydration cannot overwrite a newer event-owned field.
- **Context-menu activation**: Background captures the SidePanel-open user gesture immediately, then serializes one typed `storage.session` activation envelope with a monotonic generation. Runtime and storage delivery share one monotonic admission owner. The QR consumer commits generation, id, mode, and text through one serialized latest-wins queue and reads the physical value back before it may ACK the exact activation id; an already-mounted panel receives the newer payload without remounting, delayed delivery or write completion cannot roll it back, and a rejected or stalled write leaves the Background envelope recoverable.
- **Hover Zoom physical rules**: Background is the sole owner of the declarative-net-request rule set. Install, startup, relevant storage changes, and explicit UI requests all reconcile the complete owned rule id set against normalized settings. UI state is a receipt of that physical reconciliation, never an optimistic copy of the requested toggle.
- **Persistent browser registration**: `chrome.userScripts` and dynamically registered content scripts are browser-owned registration state, not service-worker heap state. Ordinary MV3 worker wake must not execute `storage.get -> getRegistered -> unregister -> register` as startup work.
- **Reconciliation triggers**: `runtime.onInstalled` restores/realigns browser registration after install/update; subsequent `halo_userscripts` or `halo_saat_scripts` storage authority changes request reconciliation. Concurrent requests serialize and collapse to at most one trailing full reconcile.
- **Dynamic content-script persistence**: HALO sets `persistAcrossSessions:true` explicitly instead of relying on the API default.

## Active feature lifecycle

- **Hover Zoom MSE**: Session creation returns `{ ready, dispose }` synchronously; retired sessions cannot clear newer video sources.
- **Hover Zoom input**: when enabled, the static `document_idle` host owns only light settings hydration, pointer/key tracking, exact trigger matching/highlight, and synchronous Alt ownership. The first still-valid preview intent imports one document-local `tools/_hover-zoom/runtime.js` promise and then invokes the resolver/viewer implementation. Failed imports clear the promise so a later real intent can retry. Key release, pointer retirement, disablement, or settings-authority replacement invalidates the current preview generation so a late module load cannot resurrect stale UI. When disabled, Hover Zoom removes its mouse/key listeners, pending trigger timer, viewer ownership, pending preview intent, and pending preload; only the low-frequency settings subscription remains for re-enablement.
- **Frame tools**: every matching frame retains only the minimal `content-frame-tools.js` command bootstrap. The first Ruler, DOM Selector, or Annotate activation imports `tools/_frame-tools/runtime.js` through `chrome.runtime.getURL()` and caches that document-local module promise. A failed import clears the promise so a later explicit activation can retry. STOP/CANCEL before first activation is a zero-work no-op and must not load the runtime. The static bootstrap preserves existing cross-origin iframe coverage without widening host permissions.
- **Timer and Pomodoro**: `kernel/core/deadline-jobs/coordinator.ts` is the single Background authority for commands, persistent revisions, absolute deadlines, `chrome.alarms`, cold-start reconciliation and replaceable completion effects. Per-job queues serialize state transitions; alarm wake and startup both reconcile idempotently, while a persisted completion id records pending/delivered disposition. Mounted panels send typed commands and project current time locally; their animation frame or 1Hz display ticks never own completion and panel unmount cannot strand a running deadline.
- **TTS**: speech state follows `SpeechSynthesisUtterance` lifecycle events; no periodic `speechSynthesis` polling. The tool panel owns its browser speech lifecycle and cancels any surviving utterance when the panel unmounts, so navigation cannot orphan speech without controls.
- **TOTP**: the UI may update remaining seconds at 1Hz, but HMAC output is cached for each entry/counter epoch and recomputed only when the counter or code-defining parameters change. Epoch recomputation remains sequential so account count cannot create an unbounded WebCrypto burst.
- **Panel async work**: `OwnedAsyncTask` owns one generation, deadline and disposer for panel-started work. A new run supersedes the prior generation; deadline, cancellation and unmount dispose its physical resource and prevent late results from mutating retired UI. `oneShotWorker` applies that contract to one-request static module workers and always terminates them after message, error, cancellation or deadline. Regex, PDF, Image Tools and RFC 9535 JSONPath use distinct packaged worker entries; Code Formatter and Table Extractor use the same result-admission lifecycle for their promise work without inventing another worker framework.

## Persistence admission

Every HALO write reaches `chrome.storage` through the `@nexus/kernel` storage layer. Domain code decides *what* a value means; this layer decides whether a write is admitted and what a caller is allowed to conclude from it.

- **One lane per area**: writes serialize behind one queue per physical storage area, so `local`, `sync` and `session` cannot interleave with themselves. Each lane admits at most 64 pending writes or 16 MiB of pending bytes; a write that would exceed either bound is rejected immediately instead of being queued behind work the UI has already moved past.
- **Snapshot at enqueue**: the payload is structurally cloned and sized before it joins the lane, so a later mutation of the caller's object cannot change a write that is already committed to the queue.
- **Three write outcomes**: `committed`, `rejected`, `unknown`. A lane advances only on actual settlement, never on an observer timeout — a timeout therefore reports `unknown` while the physical write keeps running. `unknown` is a first-class answer: it means the value may or may not be there, and it is never rounded to success or silently retried as if nothing had happened. The boolean helpers (such as `safeStorageSet`) answer only liveness; a caller that must distinguish rejection from uncertainty has to observe the `StorageWrite` outcome.
- **Unread is not absent**: a read that exceeds its deadline throws instead of resolving to defaults. No domain may treat a failed read as an empty record, which is why the codec-backed consumers fail closed rather than seeding defaults.
- **Ledgered read-modify-write**: `conditionalLedgerWrite` writes the value and its `key#rev` companion in one physical `set`, then verifies the stored content because a transport may drop the revision key while keeping the value. Outcomes are `committed`, `external` (someone else won; repair is a bounded caller-supplied remerge), `rejected` and `unknown`. This is optimistic concurrency, not a cross-context transaction: a plain write that skips the revision key remains an unconditional overwrite, so shared keys must be written through the ledger.
- **Quota admission**: `admitStorageGrowth` charges the browser-reported `QUOTA_BYTES` — not item counts — using key plus JSON byte length, and validates every policy fraction in `(0, 1)`. A shrinking mutation is admitted even when the stored value is already over budget, so an over-budget owner can still be repaired; a growing mutation is refused once it would cross the domain ceiling, the per-item ceiling, or the area ceiling that reserves headroom for unrelated settings and recovery writes.
- **Storage health**: failures are reported per owning domain through a symbol-keyed problem map with the statuses `read-error`, `write-error`, `write-unknown` and `invalid-data`, each retaining an optional retry closure. One banner renders that state with a retry that re-runs the retained closures. The message may describe the situation but never the stored keys or contents, so the surface cannot leak a domain value while reporting that the domain failed.

## Permissions, Localization & Performance

- **Permissions**: `permission-capabilities.ts` is the semantic manifest-capability catalog. The release verifier checks required, optional, host, and optional-host declarations; rejects duplicates and unknown capabilities; uses syntax evidence rather than comments/strings; requires runtime use to be declared; requires every optional HALO capability to have a plugin owner; and requires a matching privacy heading. Cookie Manager requests `cookies` before calling its API and reports denial instead of presenting an empty successful result.
- **Unavailable feature admission**: a plugin whose executable registry status is `coming` cannot own background/page behavior by default. Clipboard capture is fail-closed on fresh install, missing/malformed settings, and storage failure; only an explicit persisted enablement may attach its all-frame `copy` listener.
- **Localization**: Local plugin locale sources compile into generated runtime aggregates.
- **Performance**: Inactive plugins allocate 0 recurring work. Disabled high-frequency features detach their hot listeners. SidePanel hidden/inactive surfaces must not poll. Browser-owned work started by a tool panel must either transfer to another explicit owner or dispose when that panel unmounts.
- **Build evidence**: production build derives all-frame/top-frame `document_start` and `document_idle` membership from the source manifest, then charges each declared JS entry by its complete static esbuild closure. SidePanel static startup closure, Background worker bundle, eventual lazy bytes, largest chunk, and every dynamic tool activation's transitive static closure remain separately measured. Packaged on-demand modules that are not declared in `content_scripts` are not startup bytes.
- **Historical 2026-08-13 production ceilings**: the former `background <= 32KiB` and `SidePanel eventual chunks <= 1850KiB` limits, together with the other limits measured below, describe the v0.6.2 candidate only. They are retained as dated baseline evidence and are no longer current admission values. [`build.ts`](../build.ts) is the executable owner of current per-surface, aggregate worker, largest-worker, eventual-chunk and activation-closure budgets. The current worker-budget adjustment has only a pre-integration measurement; final production build evidence is pending and this document does not claim that the frozen candidate passes.
- **Measured Windows production surfaces (2026-08-13, v0.6.2 candidate)**: `all-frame@document_start = 1KiB`, `top-frame@document_start = 26KiB`, `all-frame@document_idle = 2KiB`, `top-frame@document_idle = 13KiB`, `SidePanel startup = 34KiB`, `background = 32KiB`, `Frame Tools runtime = 7KiB`, `Hover Zoom runtime = 48KiB`, `SidePanel eventual chunks = 1802KiB`, and largest activation `PDF = 1061KiB/10 files`. The 3KiB document-idle increase is the executable, fail-closed Hover Zoom settings schema replacing unchecked storage casts; startup/document-start surfaces remain unchanged. The SidePanel renderer remains Preact-only. The Background delta pays for durable activation, exact user-script admission, and physical Hover Zoom rule reconciliation rather than content startup. Future conclusions require repeatable exact-head artifact measurements; OS parity is additionally required only when the changed mechanism crosses filesystem, archive, process, or other platform-sensitive boundaries.
- **Module identity and size**: bundled modules project the extension's generated release version. `ModuleManager` exposes only enable/disable semantics because these operations do not add or remove packaged bytes; the Module Store labels them as bundled and never presents installation/download size. Production closure measurements remain the only size evidence.
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
- Provenance metadata uses stable source anchors verified against the live mechanism owner; hand-maintained source line numbers and source-folder size claims are forbidden.
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
- No Hover Zoom settings state may claim anti-hotlink rules are active until Background reads back the complete owned physical rule set.
- No context-menu activation may be cleared before the exact SidePanel consumer acknowledges it.
- No production lazy panel boundary may resolve back into the SidePanel startup bundle; physical code splitting is a build invariant.
- No performance conclusion based only on total extension bytes: startup closure and eventual feature bytes are measured separately.
- No silent growth across the audited production startup ceilings.
- No system panel may hold a second copy of an authority another owner already owns; browser permission state, module enablement and settings each keep exactly one writer.
- No panel may present declared provenance (mechanism, frequency, impact level) as measured CPU, memory or bytes, and no row exists for a mechanism whose live owner is absent.
- No storage write may be reported as saved without a committed or verified outcome; `unknown` is surfaced as uncertainty with a retry, never rounded to success and never retried as if nothing had happened.
- No domain may treat an unread key as an absent key: a read that misses its deadline throws instead of producing a default.
- Shared storage keys are written through the ledger; an unconditional overwrite of a key another context can write is an architecture defect, not a shortcut.

Roadmap sequencing lives in [`roadmap.md`](roadmap.md).

## Tool data fidelity

Identity tools preserve integer and text semantics through their visible result:
base conversion uses BigInt; UUIDv7 and ULID use the complete 48-bit time layout;
JWT viewers decode UTF-8 without treating decode as signature verification. TOTP
imports retain issuer, account, period, digits and HMAC algorithm, with RFC 6238
vectors for SHA-1/256/512; malformed or HOTP input is explicitly rejected.
Historical entries without an algorithm retain SHA-1 compatibility rather than
claiming the discarded original parameter can be recovered. New import drafts
are ephemeral; this is not a claim that stored account secrets are encrypted.

The schema-free Protobuf viewer retains raw bytes, exact 64-bit integers and
labels speculative string/message interpretations. The interactive decode
contract limits input to 256 KiB, 4,096 traversed fields and 32 nesting levels;
these are explicit product admission bounds, not hardware performance claims.
Corrupt trailing fields are errors, not successful partial results. Users can
select Hex or Base64 explicitly when auto-detection would be ambiguous.

CSV output has one Papa Parse serialization owner. Raw mode is the fidelity
default; spreadsheet-safe mode is an explicit user choice because it prefixes
formula-like fields and changes their exported text. JSON-to-CSV and Table
Extractor share that policy rather than maintaining separate escaping rules.

JSONPath uses `@swaggerexpert/jsonpath` for RFC 9535 parsing and evaluation in
a bounded one-shot worker. Invalid syntax is distinct from a valid query with
no matches, JSON object traversal uses own properties, custom executable
functions are not exposed, and input/node/depth/result limits are enforced.
CSP analysis uses `csp_evaluator` to show per-policy parsing and findings. It
distinguishes enforced and Report-Only headers, reports ignored duplicate
directives and the intersection of multiple enforced policies, and never emits
an aggregate security score or a claim that the analyzed site is secure.

Extension-initiated HTTP(S) work passes each observable URL and redirect hop
through `ssrf-guard.ts`. Unsupported schemes, embedded credentials, private or
internal literal hosts and unadmitted cross-origin redirects fail closed. A
cross-origin opaque redirect is rejected because its next target cannot be
inspected. Browser JavaScript does not expose authoritative DNS resolution, so
a public hostname remains DNS-unknown; URL admission must not be described as
proof against DNS rebinding or a later private destination.

Password generation samples a deduplicated Unicode scalar pool using rejection
sampling and the existing cryptographic random source. Complexity labels are
heuristics, not entropy certification. URL parameter views preserve duplicate
names and order; palette extraction excludes fully transparent pixels and keeps
quantized channels within the actual eight-bit gamut. These tool contracts are
executed by the default unit lane, not only ad-hoc probes.

## Actual browser launch evidence

Every HALO Playwright launch is owned by `scripts/browser-driver.ts`. After the
browser starts, that owner reads the runtime product/version and the browser
command line through CDP. A formal release run writes one receipt per physical
launch with the exact head, tree, run, attempt, stable execution sequence,
driver, platform, architecture, sanitized arguments and profile-construction
metadata. Temporary profile paths are never retained. The executable is
fingerprinted only when the browser-returned command line supplies a readable
executable path; a missing path remains typed `unknown`.

`collectDefaultReleaseBrowserOwners()` derives the required launch consumers
from the maintained package-script graph using the repository's package-token
owner and the pinned TypeScript Compiler API. Adding a direct Playwright launch
or keeping a browser test outside the default release graph is therefore an
owner-boundary regression.
