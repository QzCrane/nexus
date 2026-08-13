# SPECTRA v1.4.2

SPECTRA 1.4.2 hardens acknowledged settings, cross-context authorization, failure reporting, and production performance without widening permissions or compatibility claims.

- Settings mutations now return after the durable revision is committed, while one coalescing Background projection owner delivers Content, Popup, badge, hotkey, and restore updates with bounded fan-out and restart recovery.
- Runtime control requests can no longer claim internal `remote` or `system` authority. Page requests remain bound to the exact top document, and the obsolete Content-side legacy mutation adapter is explicitly retired.
- Popup and Options controls now surface rejected operations, roll back or resynchronize state, and no longer present default data as a successful persisted load after an RPC failure.
- Tab-wide settings, capture, visualizer, remote-session, hotkey, and worker-recovery work use bounded concurrency instead of unbounded `Promise.all` fan-out; a failed generation now waits for its live workers to retire before retry.
- Production artifacts enforce explicit ceilings for service-worker wake, document-start, Content, Popup, Options, offscreen Capture/Remote, total JavaScript, and total package bytes.
- Release and cross-platform Chrome integration consume the already-built production `dist`, removing a redundant development rebuild and duplicate integrity scan from the exact-candidate path.

Availability still depends on the page, media element, browser support, permissions, user activation, and protected-content boundaries. SPECTRA does not bypass those browser constraints.
