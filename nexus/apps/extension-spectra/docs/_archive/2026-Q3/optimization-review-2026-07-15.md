# SPECTRA optimization review — 2026-07-15

> Historical release evidence for the promoted 1.3.4 archive listed below.
> It is not the owner of the current control architecture. The exhaustive
> native/augmentation decisions, current implementation anchors and static
> invariants are maintained in
> [control architecture](../../control/README.md); current runtime ownership
> is maintained in [runtime architecture](../../architecture/runtime.md) and
> [protocols](../../reference/protocols.md).

## Outcome

The implementation is complete inside the approved scope: SPECTRA, contracts, kernel, audio-engine, remote-site, and root tooling. Halo and ui-kit source files remain unchanged.

The exact `remote-site` tree is deployed to the production Cloudflare Pages project and the complete 14-stage release gate passed. The promoted release candidate is `release/spectra-v1.3.4.zip` (558,770 B), SHA-256 `85ba24517dde9233e9b1cdcc8e3d5b2ae10d943d20c5ee89aaacbac7570076bd`.

## Delivered architecture

- One unified offscreen host owns Capture processors and authenticated PeerJS sessions. Background serializes creation, tracks `audio:<tabId>` / `remote:<sessionId>` leases, reconciles the host after a worker restart, and closes it only after a service-worker-safe one-shot 30-second alarm.
- Each document has a generation-aware `bypass | webaudio | capture` and `idle | starting | active | stopping | error` state machine. Capture is committed only after an offscreen ACK; stale ACKs cannot overwrite a newer generation.
- Popup and Options send intents only. Content owns desired document state, MAIN/offscreen own actual processing, and Background publishes the authoritative `AudioSessionSnapshot` and badge projection.
- MAIN uses one versioned runtime with shared disposal and one `MediaElementSourceNode` per media element. Default settings are transparent and create no extension `AudioContext`.
- Same-document navigation is detected by Chrome's `webNavigation.onHistoryStateUpdated` and `onReferenceFragmentUpdated`, delivered as a validated protocol-v2 event, and deduplicated by Content before generation advances.
- Settings use a revisioned Background repository, field-level patches, local persistence, document-bound session mirrors, hostname normalization, and idempotent v2 migration.
- The one-release Options theme adapter is read-only: it offers the legacy `localStorage` value through a typed revisioned consume intent. Background atomically owns eligibility, a modern `themeMode` patch wins every race, and old `language` / `theme` aliases are retained without being updated.
- Media discovery, visibility, and visualizer work are event/subscription based. Slider traffic is latest-value coalesced and persistence uses a trailing write.
- Remote pairing uses an independent 128-bit fragment secret, random peer/session identifiers, an HMAC-SHA-256 challenge, fixed tab/generation/sequence checks, and command allowlists. The remote page bundles PeerJS locally and ships restrictive deployment headers.
- Peer IDs use a 128-bit hexadecimal token that always satisfies PeerJS's separator rules; this removes the formerly probabilistic `invalid-id` failure caused by random Base64URL `-` / `_` placement.
- Upgrade handling explicitly retires the legacy six-character remote offscreen host, then refreshes active tabs first and every background tab through an awaited four-worker queue rather than suspension-prone delayed timers.
- Production is the default build. Release tooling pins Bun/Biome/Turbo, enforces source freeze, deterministic ZIP input, SHA-256 verification, extracted-ZIP Chrome smoke, transactional promotion, and removal of `.staging` before and after every release attempt.

## Final verification

| Gate | Result |
| --- | --- |
| Toolchain | Bun 1.3.14, Biome 2.5.3, Turbo 2.10.5 |
| Architecture verify | Passed |
| Workspace lint | Passed coverage for all 6 Turbo workspaces |
| SPECTRA dependency typecheck | 4/4 packages passed |
| Unit / contract / runtime tests | 188 passed, 1,826 assertions, 41 files |
| Development Chrome integration | 17 passed, 128 assertions |
| Production build and artifact scan | Passed |
| Production Chrome integration | 17 passed, 128 assertions |
| Dependency audit | 0 vulnerabilities |
| Production remote-site deployment | Passed byte, MIME, and six-header verification |
| Complete release orchestration | 14/14 stages passed |
| Deterministic ZIP / extracted-ZIP smoke | Passed; 33 files, 555,090 B extracted |
| Promoted release SHA-256 | `85ba24517dde9233e9b1cdcc8e3d5b2ae10d943d20c5ee89aaacbac7570076bd` |

The Chrome matrix loads the actual MV3 worker, isolated Content runtime, MAIN runtime, unified offscreen document, and the real `chrome.action` Popup. It verifies transparent defaults, side-effect-free Popup reads, SPA media plus query/hash navigation, fullscreen preservation, locale delivery, English/Chinese narrow-layout bounds, dynamic-control names and state in Chrome's accessibility tree, Options Modal focus trapping/restoration, visible-only action-Popup visualizer IPC, Capture denial rollback, real synthetic Capture ACK, Capture hotkey WebAudio handoff and restoration, stale ACK rejection, singleton/source reuse, one offscreen shared with authenticated remote, unauthenticated rejection, worker restart, cross-origin navigation, and tab-close cleanup.

## Bundle and performance evidence

| Metric | Historical promoted value | Evidence |
| --- | ---: | --- |
| Production dist | 555,090 B | 33 reachable production files |
| Production JavaScript | 448,451 B | 437.9 KiB measured output |
| `background.js` | 113,734 B | includes persistent idle alarm and atomic settings migration |
| `content.js` | 99,732 B | measured runtime artifact |
| `popup.js` | 119,021 B | measured Popup artifact |
| Unified `offscreen.js` | 59,998 B | measured unified host artifact |
| Promoted ZIP | 558,770 B | deterministic stored archive of the production dist |

- Production dist contains 33 files, zero source maps, zero test files, and zero debug console/source-map/development endpoint strings.
- At this historical release snapshot, the static scan found zero `setInterval` calls and one finite post-activation CORS signal observation interval. The current architecture no longer uses analyser silence or timed CORS probing; see [cors-data-flow.md](./cors-data-flow.md).
- Real Chrome default-path smoke reports zero extension-created `AudioContext` instances and zero offscreen documents before user intent.
- A 100-value slider burst produces one latest-value IPC containing the final value.
- Settings persistence uses one 250 ms trailing storage write and flushes on committed change/page close.
- A real Chrome action Popup probe observes batched visualizer requests while the card is visible and zero additional visualizer IPC after the Popup is no longer visible; non-intersecting cards also stop scheduling through the shared 15 Hz ceiling.

## Lint scope evidence

The root lint gate discovers all six Turbo workspaces and refuses uncovered additions.

- SPECTRA, contracts, kernel, and audio-engine use direct Biome tasks.
- ui-kit remains out of modification scope and passed the fallback scan with 0 errors and 1 existing warning.
- Halo remains out of modification scope. Its frozen baseline currently records 925 files, 634 errors, 176 warnings, and 93 infos; the gate rejects new diagnostics, severity increases, tool/config drift, or a reduced file scan.

## Release and deployment closure

- Cloudflare OAuth was renewed and the exact six-file `D:\Project\Nexus\remote-site` directory plus `_headers` was deployed to the `nexus-remote` production project.
- Cloudflare Pages Web Analytics had been automatically injecting an external beacon into `index.html`. The project's `build_config.web_analytics_tag` and `build_config.web_analytics_token` were cleared through the Pages API, preserving the strict self-only script CSP and byte-identical deployment contract.
- Production `https://nexus-remote.pages.dev/` now matches the local root, `index.html`, `app.js`, `styles.css`, and bundled `vendor/peerjs.min.js`; MIME and CSP, Referrer-Policy, Permissions-Policy, X-Content-Type-Options, X-Frame-Options, and Cross-Origin-Opener-Policy all pass.
- The first complete release attempt exposed that TypeScript's generated `*.tsbuildinfo` files were included in the frozen source digest. Release tooling now excludes only this incremental metadata and has a regression test proving real source changes remain bound to the promotion receipt.
- The successful rerun completed all 14 gates, staged a deterministic ZIP, extracted and loaded its 33-file payload in Chrome, then transactionally promoted the verified archive/checksum pair.
- Independent post-promotion verification confirms ZIP SHA-256 `85ba24517dde9233e9b1cdcc8e3d5b2ae10d943d20c5ee89aaacbac7570076bd`, matching `.sha256`; the archive expands to the exact 555,090-byte production dist.
- No `.staging` directory, source map, test file, or Wrangler workspace cache remains. `git diff --check` passes.
