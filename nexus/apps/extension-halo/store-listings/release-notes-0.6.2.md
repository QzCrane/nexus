# HALO v0.6.2

HALO 0.6.2 closes browser-lifecycle, permission, public-identity, and production-performance gaps across the existing toolset.

- Hover Zoom now reconciles its anti-hotlink rules from one Background owner on install, startup, setting changes, and explicit UI requests. The UI reports the physical rule state and does not claim success after a browser API failure.
- Context-menu QR activation uses a monotonic durable envelope across SidePanel startup delay, cannot be rolled back by a late delivery channel, and ACKs only after the exact QR text is persisted.
- Clipboard capture is consistently disabled on missing, malformed, or unreadable settings across Content, SidePanel, and runtime-status projections.
- Cookie Manager requests the optional `cookies` permission before use; history, bookmarks, and tab-group capability ownership are now executable permission metadata rather than undocumented assumptions.
- Module Store entries now show the actual extension release identity and use honest enable/disable semantics for code already bundled with HALO. Source-folder bytes are no longer presented as installed size.
- Manual JavaScript tests now use Chrome's `userScripts.execute` path under the same optional permission and host-access gate as automatic registration; public copy distinguishes isolated `USER_SCRIPT` and page-visible `MAIN` worlds.
- Production builds enforce startup, lazy-runtime, eventual SidePanel, largest-chunk, and complete per-tool activation-closure byte ceilings. Resource Impact Inventory labels static provenance as declarations rather than CPU or memory measurements.
- Public Hover Zoom copy now reflects page, permission, and browser restrictions instead of promising universal website compatibility.

The attached ZIP is the deterministic production package. Verify it with the accompanying SHA-256 file before loading or distributing it.
