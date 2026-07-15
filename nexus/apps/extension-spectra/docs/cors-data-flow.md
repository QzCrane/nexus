# CORS Audio Decision Flow

`createMediaElementSource()` may succeed while cross-origin audio produces no analyser data, so SPECTRA treats the analyser callback—not an exception—as the runtime signal.

## Flow

1. Normalize the current hostname and query the background-owned registry.
2. A previously probed entry restores `SAFE` or `RESTRICTED`; an unknown host starts as `PENDING`.
3. The event-driven media registry reacts to newly inserted media, playback, metadata, volume, and SPA navigation. It selects an audible, playing candidate once; there is no discovery polling.
4. The WebAudio controller reports real analyser success or failure through its callbacks.
5. Background persists the normalized probe result through the v2 registry boundary.
6. Policy is recalculated for the current document generation. A late callback from an older generation cannot activate Capture.

While status is unknown, policy fails closed for advanced processing. Default/no-op configuration remains transparent bypass and does not create an AudioContext merely to probe a site.

## Ownership

- `policy-executor/cors-handler.ts`: current-document CORS phase and controller callbacks
- `policy-executor/media-probe.ts`: one-shot candidate selection
- `core/lifecycle/media-observer.ts`: event-driven media discovery and disposal
- `shared/registry-client.ts`: typed registry requests
- background registry repository: normalized persistence and domain matching

The authoritative audio mode and error remain in `AudioSessionSnapshot`; the registry result is an input to policy, not an independent claim that Capture is active.
