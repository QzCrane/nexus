---
type: explanation
status: stable
audience: developer
owner: halo-sidepanel-storage-authority
last_reviewed: 2026-08-09
---

# HALO SidePanel storage authority

HALO SidePanel code is emitted as more than one JavaScript bundle (`sidepanel-init.js`, React `sidepanel.js`, and lazy tool code) but those scripts execute in the same SidePanel JavaScript realm. Storage observation therefore has two separate concerns:

1. **physical event transport** — how many `chrome.storage.onChanged` callbacks the SidePanel realm registers;
2. **domain authority** — which component owns validation, hydration, mutation, and projection for a particular storage key.

They must not be conflated.

## One physical realm transport

`kernel/core/storage-change-bus.ts` owns the SidePanel realm's Chrome storage-change registration.

Its state is stored on:

```text
globalThis.__HALO_STORAGE_CHANGE_BUS_V1__
```

A module-local singleton is insufficient because separately bundled entry scripts would each instantiate their own module copy. A realm-global singleton ensures those bundles converge on one subscriber set and one physical Chrome listener.

Bus invariants:

- first subscriber attaches the Chrome listener;
- final subscriber detaches it;
- event delivery iterates over a subscriber snapshot;
- subscribe/unsubscribe during a callback changes the next event, never the current delivery;
- the bus carries `(changes, areaName)` only and does not interpret domain state.

Current high-fanout SidePanel consumers routed through the bus include:

- pre-React SidePanel smooth-scroll settings;
- i18n locale changes;
- global HALO settings;
- ActiveServices;
- generic `useToolState` storage changes;
- UserScripts persistence authority;
- Clipboard panel history/settings.

Content scripts and the MV3 service worker are different browser execution realms and retain their own explicit listeners where required.

## Domain authorities remain independent

The bus is transport, not state ownership.

Examples:

- `useToolState` retains its own write revision, echo suppression, debounce, lifecycle epoch and repair semantics;
- ActiveServices retains its combined readiness/status projection;
- UserScripts owns its persistence schema and latest-wins hydration;
- module installation owns packaged capability enablement.

Moving an observer onto the bus must not weaken its domain-specific ordering or validation.

## UserScripts persistence authority

`system/userscripts/storage-authority.ts` owns the complete `halo_userscripts` persisted record for SidePanel consumers.

### Hydration ordering

- subscribe before committing hydration;
- live storage event beats an older read resolve;
- live event also beats an older rejected read;
- stop/remount advances lifecycle generation so an old request cannot commit into a new mount;
- explicit refresh is revision-fenced;
- failed read publishes fail-closed state rather than historical default-on state.

A truly missing key is different from an I/O failure: missing key preserves the historical product default (`globalEnabled:true`); storage failure is `failed:true`, disabled, empty.

### Whole-snapshot fail closed

Any malformed persisted script row invalidates the entire snapshot. Partial acceptance could retain a registry-managed script while dropping ownership data or silently broaden execution scope.

Required safety boundaries include:

- nonempty, nonblank `matches`;
- valid script type/run-at/world;
- finite numeric counters/timestamps;
- explicit toolbar config is exactly one permutation of `add`, `export`, `import`;
- known ownership fields are validated:
  - `saatToolId`
  - `managedBy`
  - `moduleBuiltIn`.

A missing/empty match set must never reach the Background registry and become implicit `*://*/*` authority.

### Forward-compatible metadata

The canonical snapshot is a persistence mirror, not a Launcher DTO. Safe future JSON-like fields are cloned, preserved, and recursively frozen. Functions, non-finite numbers, cycles, excessive nesting, and prototype-dangerous keys fail the row instead of being silently removed.

Snapshot types model nested `matches`, `excludeMatches`, toolbar order, and canonical fields as readonly. Runtime freezing and static types therefore describe the same mutability contract.

## Mutation publication

Owned UserScripts mutations write storage and let the storage event publish the new canonical snapshot. They do not immediately issue a second `storage.get()` for the same write.

This removes duplicate I/O and avoids a stale refresh racing the event that represents the actual physical write.

Explicit external-refresh flows may still request a revision-fenced read when no owned storage write is involved.

## Integration with module installation

UserScripts persistence and UserScripts module installation are different authorities.

- persistence authority retains **all** canonical records;
- the `userscripts` module determines whether custom user-authored script UI/runtime is active;
- packaged scripts and SaaT runtimes retain their own module ownership metadata/tombstones;
- Launcher and ActiveServices combine these authorities only at projection boundaries;
- module-state storage observation in the SidePanel must use the same realm bus rather than creating another physical listener.

## Review rule

Adding a new shared/high-fanout SidePanel storage observer should use `subscribeHaloStorageChanges`. A new direct `chrome.storage.onChanged.addListener` requires an explicit architectural reason that it runs in a different browser realm or cannot safely share the transport.
