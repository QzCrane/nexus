# SPECTRA Runtime Protocols

This document is the owner narrative for SPECTRA runtime state and cross-context communication.

## State ownership

| Context | Owns | Must not do |
| --- | --- | --- |
| Popup / Options | User intent and immediate local rendering | Predict the active audio mode, write badges, or mutate storage directly |
| Content (ISOLATED) | Desired config for the current document and its media registry | Claim Capture active before an acknowledged processor exists |
| MAIN runtime | Actual page WebAudio graph, playback-rate/fullscreen patches, and their disposer | Install a second runtime or bind one media element twice |
| Offscreen host | Actual tab-capture processors and authenticated PeerJS sessions | Create or close its own document |
| Background | Routing, settings repository, session snapshots, leases, and badges derived from actual ACKs | Treat a read as activation or close offscreen outside the coordinator |

The shared read model is `AudioSessionSnapshot`: `tabId + documentId + origin`, generation, desired/actual mode, phase, config revision, actual config, and last error. UI, badge, and remote state are projections of this snapshot.

## Protocol v2

All new cross-context requests use the mapped contracts in `@nexus/contracts`:

```text
{ protocolVersion, requestId, tabId?, documentId?, generation?, type, payload }
```

Responses are exactly one of:

```text
{ ok: true, data }
{ ok: false, error: { code, message, retryable } }
```

Runtime guards validate the request type together with its payload and validate request-specific response data. A request from the wrong Chrome sender context is rejected even when its shape is valid.

The one-release v1 adapter is isolated from current feature clients: all current clients emit v2 requests and events, while named compatibility broadcasts and legacy receivers keep already-loaded content contexts alive during an extension update. It was introduced with the 1.3.4 v2 rollout and is scheduled for removal in 1.4.0, after one complete store release cycle.

## Audio configuration and mode transition

```text
UI/hotkey intent
  -> background settings/session boundary
  -> content desired config + generation
  -> MAIN WebAudio or background/offscreen Capture start
  -> actual ACK
  -> AudioSessionSnapshot
  -> badge/UI/remote projection
```

Reads such as Popup open, settings get, and audio status get are side-effect free. The default config remains transparent bypass: no AudioContext, compressor, EQ, limiter, or periodic work.

Mode changes use a generation and an acknowledged handoff:

1. Make the old path transparent.
2. Start the new path for the current generation.
3. Commit `active` only after the actual runtime ACK.
4. Release the old path.
5. Ignore every ACK from an older generation.

If Capture creation fails, background returns a structured error and restores the last stable mode/snapshot. An offscreen processor ending unexpectedly publishes a typed event that reconciles the authoritative snapshot.

## MAIN singleton and media lifecycle

The document installs one versioned MAIN singleton. It owns every descriptor patch, observer, and listener through a common disposer. `MediaElementSourceNode` ownership is stored in a `WeakMap`; an element is never rebound during the document lifetime. A hot update reuses the compatible runtime. Sources that cannot be adopted stay in transparent bypass until the next full navigation.

Content media discovery is event driven: one mutation registry plus `play`, `pause`, `loadedmetadata`, `volumechange`, and SPA navigation events. There are no 1/3/5-second discovery or state heartbeats. Top-level document replacement invalidation comes from `webNavigation.onBeforeNavigate`. Same-document History/query/hash changes come from `webNavigation.onHistoryStateUpdated` and `onReferenceFragmentUpdated`, travel through the validated `spectra.navigation.changed` v2 event, and are deduplicated by the current Content document before generation advances.

## Unified offscreen lifecycle

One `offscreen.html` hosts both tab audio and remote sessions. Background's coordinator is the only lifecycle owner:

- audio lease: `audio:<tabId>`
- remote lease: `remote:<sessionId>`
- creation: serialized and rechecked inside the mutex
- recovery: host HELLO reports actual processors and remote sessions after a service-worker restart
- close: only after every local/recovered lease is gone and a one-shot `chrome.alarms` 30-second grace period expires, so worker suspension cannot lose cleanup
- failed HELLO: fail closed as an unknown live host; never infer an empty host

Audio and remote modules acquire/release leases and exchange typed host messages; they never call `chrome.offscreen.createDocument()` or `closeDocument()`.

## Settings and concurrency

Background owns the revisioned settings repository in `chrome.storage.local`. `chrome.storage.session` contains only current tab/document session mirrors. UI sends field-level patches. Site hotkeys use binding-level `ensure/delete/set-enabled/upsert/remove` intents so a revision-conflict retry is applied to the latest snapshot instead of replaying an old whole-site object.

The 1.3.4 migration writes canonical `lang` and `themeMode` fields, then reads them back before marking schema v2 complete. Legacy `globalSettings.language` and `globalSettings.theme` values, plus unknown user fields, are retained unchanged for this release cycle but are never written from new UI changes. Options may offer the old `localStorage` `theme` value only through the typed `legacy-theme` consume intent on `spectra.settings.patch`; the background atomically consumes its eligibility bit. Any normal v2 `themeMode` patch disables that migration first, so a late legacy value cannot overwrite a current preference. The read-only aliases, localStorage adapter, and intent are scheduled for removal in 1.4.0.

Hostnames are normalized to lowercase IDNA without a trailing dot. Domain rules match the exact host and dot-boundary subdomains; IP rules are exact only.

## Hotkeys and privileged actions

The action registry is exhaustive: Options exposes only actions with a runtime handler and valid parameter schema. Pitch bindings migrate to a disabled legacy list. Command slots expose only actions whose full intent fits the slot schema. Page-generated keyboard events are rejected with `event.isTrusted === false` before matching actions. `open_url` accepts only HTTP(S); `run_js` still requires Chrome's explicit userScripts permission and isolated userScripts world.

## Authenticated remote control

Each session has independent 128-bit session, peer, secret, and host-capability tokens. The pairing secret is carried only in the URL fragment. The host challenges a controller with a random nonce; HMAC-SHA-256 over nonce, session ID, and protocol version proves possession. No state or command is accepted before authentication. Sequence, generation, capability, session ID, and fixed tab ID are checked for every command. See [remote-security.md](./remote-security.md).

## Visualizer and persistence budgets

Popup updates are latest-value coalesced to at most 20 IPC writes per second; storage uses a 250 ms trailing write and flushes on committed change/page close. Visualizer sampling is subscription based, at most 15 Hz per tab and one batch per popup scheduler. Hidden or non-intersecting cards unsubscribe immediately.
