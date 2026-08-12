---
type: explanation
status: stable
audience: developer
owner: halo-module-lifecycle
last_reviewed: 2026-08-12
---

# HALO packaged-module lifecycle

HALO modules are extension-packaged capabilities. Module Store does not download, unpack, replace, or dynamically install executable code. The lifecycle authority therefore models **whether packaged optional capability is enabled/owned**, not a simulated package manager.

## Canonical installation semantics

| Module state | Physical authority | Effective state |
| --- | --- | --- |
| `builtIn:true` | manifest/registry | always installed; cannot be removed |
| optional, no installation key | packaged default | installed |
| optional, `halo_module_enabled_v2:<id> = false` | local tombstone | uninstalled |
| optional, explicit malformed value | local tombstone boundary | fail closed |

Reinstall removes the false tombstone. Fresh profiles require no seed writes. Each optional module has an independent `chrome.storage.local` key, avoiding read/modify/write conflicts between unrelated modules and giving SidePanel, content scripts, and service worker one physical cross-context truth.

## ModuleManager authority

`kernel/managers/module-manager.ts` owns the SidePanel projection.

Hydration is event-first: storage subscription attaches before the initial read, and a live storage event owns that module over an older hydration result. Initial hydration retries once immediately.

`degraded` is not a warning layered over last-known optional state. It is a public authority boundary:

```text
built-ins => installed
all optional modules => unavailable / not installed
```

The manager may continue absorbing physical optional-module events into its private cache while degraded, but it does not publish those optional modules as installed until a complete hydration succeeds. This keeps SidePanel, Module Store, open-tool restoration and any other snapshot-only consumer fail-closed without requiring a second per-consumer degraded check.

`retryInstallationState()` publishes only when effective installation/degraded authority changes. A healthy no-op retry preserves the exact `useSyncExternalStore` snapshot object and emits no subscriber notification.

## Cross-context mutation serialization

A local snapshot is never used to elide install/uninstall intent. Every optional mutation:

```text
persist requested state
  -> physically reread the module key
  -> publish the observed physical value
```

The complete write+reread transaction is serialized by two layers:

1. a realm-shared per-module promise tail;
2. a named Web Lock `halo-module-installation-v2:<id>` across extension contexts.

The extension never silently falls back to realm-only mutation serialization in production. If a real extension context lacks Web Locks, the mutation fails closed. Test/non-browser custom persistence may use the realm-local fallback.

## Runtime gating

An uninstalled module may not keep executing merely because its code exists in the extension package.

### Smooth Scroll

Document input ownership requires:

```text
feature settings enabled
AND
smooth-scroll module installed
AND
both authorities hydrated
```

Settings and module storage hydrate independently with event-first ordering. Either read failure disables input ownership. Wheel/mousedown listeners retire on ownership loss. The document-start keydown/keyup observation seam remains physically registered for stable website-first ordering but both observers are inert unless `runtimeEnabled()` is true.

### Script runtime ownership

Registry-managed script execution has three owners:

| Runtime class | Installation owner | Content setting |
| --- | --- | --- |
| custom user-authored script | `userscripts` module | `halo_userscripts.globalEnabled` |
| packaged script module | its own module id | `halo_userscripts.globalEnabled` |
| SaaT tool runtime | its own tool/module id | `halo_saat_scripts.globalEnabled` |

The UserScripts module tombstone must never disable an unrelated packaged script. Ownership vocabulary is canonical in `kernel/core/script-runtime-ownership.ts`:

```text
packaged-script | saat-tool
```

Generated install-time descriptors carry explicit `builtIn:boolean`. The kernel SaaT descriptor consumer rejects missing `builtIn` before registry storage is mutated.

## Registry generation preparation

Browser registrations are destructive to replace, so all static generation errors must be detected before unregistering the working generation.

The registry first parses the canonical persistence schema and validates ownership containers. It then prepares the entire next generation before teardown. Preparation rejects:

- empty/blank match sets;
- malformed ownership metadata;
- an `ISOLATED` script without packaged `filePath`;
- duplicate enabled runtime IDs.

Explicit `MAIN` world is preserved. Unspecified non-ISOLATED world retains the historical `USER_SCRIPT` default.

Only after successful preparation does the registry unregister previous HALO registrations and register the prepared generation. Unregister/register errors propagate into durable recovery.

## Chrome User Scripts capability authority

HALO declares `userScripts` and broad host access as optional permissions. Chrome 138+ also exposes a separate per-extension **Allow User Scripts** platform toggle.

`system/userscripts/capability.ts` owns one runtime capability probe. Namespace presence alone is not authority: HALO calls `chrome.userScripts.getScripts()` and treats namespace absence or method rejection as unavailable.

The same capability owner is consumed by Background registry reconciliation and the SidePanel UserScripts readiness projection. SidePanel readiness requires all three facts:

```text
host permission
AND
userScripts optional permission
AND
actual userScripts API capability
```

Granting optional permissions therefore does not blindly mark UserScripts ready. If Chrome's platform toggle remains off, the UI tells the user to enable **Allow User Scripts**. A false -> true runtime capability transition requests one Background `HALO_USERSCRIPTS_SYNC`.

## Persistent registry receipt v2

Browser registrations survive MV3 worker suspension, while Chrome's User Scripts platform gate can temporarily make its persistent generation unavailable for reconciliation. The old dirty-boolean-clear model therefore does not express enough state.

The registry persists one receipt under its recovery key:

```text
dirty
blocked { digest }
clean   { digest }
```

Meaning:

- `dirty`: synchronization is in progress or failed; bounded retry owns recovery;
- `blocked`: storage/module authority is known, but the User Scripts platform capability is unavailable, so the browser's persistent `userScripts` generation cannot be proven current;
- `clean`: the complete browser registration generation is proven converged.

The SHA-256 authority digest covers the raw user-script container, raw SaaT container, UserScripts module tombstone, owned module tombstones, and actual User Scripts platform availability. Canonical encoding sorts object keys, represents `undefined` distinctly, and rejects unsupported primitives instead of silently collapsing them.

Startup recomputes physical authority and applies this satisfaction rule:

```text
capability available   => matching clean receipt only
capability unavailable => matching blocked receipt only
anything else          => reconcile
```

A matching blocked receipt prevents pointless full reconciliation on every worker wake while Chrome's platform gate remains off. When capability returns, the blocked receipt cannot satisfy the new authority and reconciliation must complete before `clean` is written.

Failures keep/reassert `dirty` and use bounded current-worker retries at 250 ms, 1 s, and 4 s. A satisfied clean/blocked worker wake does not rebuild the registry.

### Platform re-enable boundary

Chrome retains dynamically registered User Scripts while its platform source is disabled and may re-enable the persisted browser generation when **Allow User Scripts** is turned back on before HALO finishes its own post-enable reconciliation.

The `blocked` receipt models this honestly but cannot reorder Chrome's internal enable transition. Installed-Chromium evidence must determine whether an old persisted generation can execute in that interval. If it can, this requires additional runtime hardening; it must not be waived or described as a clean zero-window transition.

## SidePanel lifecycle

`builtIn` is the sole packaged-module uninstallability property. `pluginType` is taxonomy only.

- optional system modules are removable;
- active/restored optional system panels obey installation state;
- Launcher custom-script cards require healthy, non-degraded UserScripts module authority;
- packaged/SaaT records are not re-projected as custom script cards;
- open-tool hydration is epoch-fenced against stale async replay.

## Integration with SidePanel storage authority

Module lifecycle and SidePanel storage transport are separate concerns. #20 owns installation/runtime/capability/recovery semantics; #25 owns the SidePanel realm storage bus and canonical lossless `halo_userscripts` snapshot.

The integrated candidate must preserve both: module installation remains runtime enablement authority; the SidePanel bus multiplexes physical `storage.onChanged`; UserScripts persistence preserves registry ownership metadata; Launcher/ActiveServices derive narrow projections; background/content listeners remain separate browser realms.

## Non-goals

This architecture does not claim remote module downloads, extension-code hot replacement, package signature verification, dependency resolution, or an update installer. A real package installation mechanism requires a separate explicit architecture rather than reviving removed simulated states.
