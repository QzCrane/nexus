---
type: explanation
status: stable
audience: developer
owner: halo-module-lifecycle
last_reviewed: 2026-08-12
---

# HALO packaged-module lifecycle

HALO modules are extension-packaged capabilities. Module Store controls whether optional packaged capability is enabled/owned; it does not simulate downloading or replacing code.

## Installation authority

| Module state | Physical authority | Effective state |
| --- | --- | --- |
| `builtIn:true` | manifest/registry | always installed; cannot be removed |
| optional, no installation key | packaged default | installed |
| optional, `halo_module_enabled_v2:<id> = false` | local tombstone | uninstalled |
| optional, malformed explicit value | local tombstone boundary | fail closed |

Each optional module owns one independent `chrome.storage.local` key. Reinstall removes the false tombstone. Fresh profiles require no seed writes.

## ModuleManager

`kernel/managers/module-manager.ts` owns the SidePanel packaged-module projection.

- storage subscription precedes hydration;
- live events outrank older hydration reads;
- built-ins remain installed during storage failure;
- complete degraded authority projects every optional module unavailable;
- initial hydration gets one immediate retry;
- successful retry publishes only real authority/degraded changes;
- healthy no-op retry preserves the exact external-store snapshot object;
- a stale local projection never elides a requested enable/disable write;
- mutation completion rereads the physical key before publishing;
- same-module write+reread transactions serialize through a realm queue plus a named Web Lock;
- a real extension context fails closed if Web Locks is unavailable instead of silently reverting to realm-only serialization.

After SidePanel storage-authority integration, ModuleManager's storage-event input is multiplexed through the SidePanel realm bus; its persistence, degraded-state and locking semantics remain ModuleManager-owned.

## Runtime gating

An uninstalled optional module may not keep executing merely because its code exists in the extension package.

### Smooth Scroll

Input ownership requires:

```text
settings enabled
AND module installed
AND both authorities hydrated
```

Either read failure fails closed. Wheel/mousedown listeners retire on ownership loss. Document-start keyboard observers remain physically stable for website-first ordering but keydown/keyup handling is inert unless `runtimeEnabled()` is true.

### Script runtimes

| Runtime class | Installation owner | Content setting |
| --- | --- | --- |
| custom user-authored script | `userscripts` module | `halo_userscripts.globalEnabled` |
| packaged script module | its own module id | `halo_userscripts.globalEnabled` |
| SaaT tool runtime | its own tool/module id | `halo_saat_scripts.globalEnabled` |

Built-in packaged scripts therefore survive the unrelated UserScripts module tombstone.

Ownership vocabulary is canonical in `kernel/core/script-runtime-ownership.ts`:

```text
packaged-script | saat-tool
```

Generated install-time descriptors carry explicit `builtIn:boolean`, and the SaaT descriptor consumer rejects malformed ownership before mutating registry storage.

## Persistent browser-registration authority

Browser registrations survive ordinary MV3 worker suspension, so logical persistence and Chrome registration state must converge durably.

The complete desired generation is validated before the live generation is retired:

- empty/blank matches fail closed;
- container ownership must be valid;
- ISOLATED scripts require `filePath`;
- explicit MAIN world is preserved;
- duplicate enabled runtime IDs fail before unregister;
- unregister/register failures propagate.

### Receipt v2

Recovery is represented by three persistent states:

- `dirty`: reconciliation is running or failed;
- `blocked {digest}`: persisted authority is known but Chrome User Scripts capability is unavailable, so the browser's persistent userScripts generation cannot be proven current;
- `clean {digest}`: the complete browser registration authority is proven converged.

The authority digest covers raw user/SaaT persistence, UserScripts and managed-module tombstones, actual Chrome User Scripts capability, and `chrome.runtime.getManifest().version`.

Including the extension version is required because an extension update may clear dynamic User Scripts registrations while storage remains byte-identical. A previous-version clean receipt therefore cannot satisfy the new worker's authority.

Capability-sensitive satisfaction rules are strict:

```text
User Scripts available   -> matching clean only
User Scripts unavailable -> matching blocked only
```

Dirty, wrong digest or wrong state triggers reconciliation. Current-worker failure retries are bounded at 250 ms, 1 s and 4 s.

`ensureRegisteredScriptsSynchronized()` is an idempotent receipt barrier: a satisfied authority returns without destructive unregister/register I/O. `ensureUserScriptsRuntimeReady()` is stronger and succeeds only after final `userScriptsAvailable=true` plus a matching clean receipt.

## Panel readiness

Chrome's optional `userScripts` permission is not sufficient by itself; modern Chrome also exposes a per-extension Allow User Scripts platform gate. HALO uses an actual `chrome.userScripts.getScripts()` method probe rather than namespace presence alone.

The UserScripts panel reports runtime-ready only after:

1. broad host permission is present;
2. `userScripts` optional permission is present;
3. the real User Scripts capability probe succeeds;
4. Background `HALO_USERSCRIPTS_SYNC` returns success after `ensureUserScriptsRuntimeReady()` proves a clean available receipt.

Permission/status refreshes return explicit `ready | unavailable | stale`. Retired async refreshes cannot be mistaken for final unavailable state. Every platform-available refresh crosses the idempotent Background receipt barrier, so a panel that was previously ready cannot keep advertising readiness after script authority changes. Committed script-authority changes trigger revalidation.

Chrome may internally reactivate its own persisted dynamic-script source before extension reconciliation when Allow User Scripts is re-enabled. This architecture does not claim a zero-stale-generation execution window until installed-Chromium evidence proves that transition.

## SidePanel projection

`builtIn` is the sole packaged-module uninstallability property; `pluginType` is taxonomy only.

- optional system modules are removable;
- active/restored optional panels obey installation authority;
- Launcher custom-script cards require healthy non-degraded UserScripts module authority;
- packaged/SaaT records are excluded from custom Launcher projection;
- open-tool hydration is epoch-fenced against stale replay.

The final #20 × #25 integration keeps persistence transport separate from runtime ownership: one SidePanel storage bus, one lossless UserScripts persistence authority, ModuleManager installation authority, and Background browser-registration receipt authority.

## Verification boundary

Static source contracts are not merge evidence. The final integrated candidate requires HALO typecheck, the full registered unit suite, production build/integrity, and installed Chromium lifecycle tests on the exact head. Windows + Ubuntu parity is additionally required when a change touches filesystem/path/archive/process/toolchain behavior; ordinary browser lifecycle changes do not gain product authority merely by repeating the same Chromium behavior on Ubuntu. Hosted CI is a replay surface when runners are available, while local exact-head evidence remains valid during provider billing outages. The tracked generated registry must also be regenerated from canonical manifests after provenance changes; generated output is not an independent hand-maintained authority.
