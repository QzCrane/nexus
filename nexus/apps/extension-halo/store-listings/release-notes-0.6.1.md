# HALO v0.6.1

HALO 0.6.1 fixes smooth-scroll keyboard ownership on pages that contain video.

- Arrow Up and Arrow Down now scroll page content when focus and pointer interaction are outside the player, even while a video is visible.
- Direct pointer or focus interaction with media keeps arrow keys available to the player or website until interaction moves away.
- HALO suppresses site-global arrow shortcuts only after a valid page-scroll route is admitted.
- Existing wheel, Space, Page Up, Page Down, editable-control, fullscreen, reduced-motion, and nested-scroller behavior remains covered by unit and production Chromium tests.
- Release metadata now includes accurate privacy, permission, network, and storage disclosures; three unused optional permissions were removed.

The attached ZIP is the deterministic production package. Verify it with the accompanying SHA-256 file before loading or distributing it.
