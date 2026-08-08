---
type: explanation
status: stable
audience: developer
owner: halo-module-lifecycle
last_reviewed: 2026-08-09
---

# HALO packaged-module lifecycle

HALO modules are extension-packaged capabilities. Current Module Store actions do not download, unpack, replace, or dynamically install executable code. The lifecycle authority therefore models **whether packaged optional capability is enabled/owned**, not a simulated package manager.

## Canonical installation semantics

| Module state | Physical authority | Effective state |
| --- | --- | --- |
| `builtIn:true` | manifest/registry | always installed; cannot be removed |
| optional, no installation key | packaged default | installed |
| optional, `halo_module_enabled_v2:<id> = false` | local tombstone | uninstalled |
| optional, explicit malformed value | local tombstone boundary | fail closed |

Reinstall removes the false tombstone. Fresh profiles require no seed writes.

Each optional module has an independent `chrome.storage.local` key. This avoids read/modify/write conflicts between unrelated modules and lets SidePanel, content scripts, and the service worker consume one physical cross-context truth.

## ModuleManager

`kernel/managers/module-manager.ts` is the SidePanel projection owner.

Invariants:

- subscribe before storage hydration;
- a live storage event outranks an older hydration read;
- built-ins are present before and during storage failure;
- optional state is fail-closed while installation storage cannot be read;
- initial hydration gets one immediate retry;
- persistent failure is explicit `degraded` state;
- `retryInstallationState()` publishes a new external-store revision only when effective module/degraded authority changes;
- healthy no-op retry preserves snapshot identity;
- same-module mutations serialize;
- a context-local snapshot is never used to elide an install/uninstall write;
- mutation completion rereads the physical key before publishing.

React consumes one immutable `useSyncExternalStore` snapshot.

## Runtime gating

An uninstalled module may not keep executing merely because its code exists in the extension package.

### Smooth Scroll

Document input ownership requires both:

```text
feature settings enabled
AND
smooth-scroll module installed
```

Settings and module storage hydrate independently with event-first ordering. Either read failure disables input ownership. Wheel/mousedown listeners retire on uninstall. The document-start keyboard observation seam remains registered but inert so reinstall does not produce a later website-first listener order.

### Script runtimes

Registry-managed script execution has three distinct owners:

| Runtime class | Installation owner | Content setting |
| --- | --- | --- |
| custom user-authored script | `userscripts` module | `halo_userscripts.globalEnabled` |
| packaged script module | its own module id | `halo_userscripts.globalEnabled` |
| SaaT tool runtime | its own tool/module id | `halo_saat_scripts.globalEnabled` |

The UserScripts module tombstone must never disable an unrelated packaged script such as a built-in Bilibili module.

Ownership vocabulary is canonical in `kernel/core/script-runtime-ownership.ts`:

```text
packaged-script | saat-tool
```

Generated install-time descriptors carry explicit `builtIn:boolean`. The kernel SaaT descriptor consumer rejects missing `builtIn` before registry storage is mutated.

## Persistent registry reconciliation

Browser registrations survive MV3 worker suspension, so logical storage state and browser registration state must converge durably.

A reconciliation request follows:

```text
persist dirty marker
  -> read desired script/module state
  -> unregister previous HALO generation
  -> register exact desired generation
  -> clear dirty marker only after full success
```

Unregister/register errors propagate. Current-worker retries are bounded at 250 ms, 1 s, and 4 s. Dirty state survives worker loss and is a startup recovery boundary. A clean installed worker wake does not rebuild the registry.

Empty or blank persisted match sets are invalid and fail closed; they must never be interpreted as implicit all-URL authority.

## SidePanel lifecycle

`builtIn` is the sole packaged-module uninstallability property. `pluginType` is taxonomy only.

- optional system modules are removable;
- active/restored optional system panels obey installation state;
- Launcher custom-script cards exist only while UserScripts is installed;
- packaged/SaaT records are not re-projected as custom script cards;
- open-tool hydration is epoch-fenced against stale async replay.

## Integration with SidePanel storage authority

The module lifecycle and SidePanel storage transport are separate concerns.

After integration with the SidePanel storage-authority work:

- module installation remains the runtime enablement owner;
- the SidePanel realm bus multiplexes physical `storage.onChanged` delivery;
- the UserScripts persistence authority preserves the full canonical record including registry ownership metadata;
- Launcher/ActiveServices derive narrow projections from those authorities;
- content-script and service-worker listeners remain separate because they run in separate browser execution realms.

## Non-goals

This architecture does not claim to support remote module downloads, extension-code hot replacement, package signature verification, dependency resolution, or an update installer. If HALO gains a real package installation mechanism, it requires a separate explicit architecture rather than reviving the removed simulated states.
