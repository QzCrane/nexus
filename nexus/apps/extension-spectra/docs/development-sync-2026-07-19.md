# SPECTRA development sync — 2026-07-19

This document records the implementation that landed after the 2026-07-18
regression snapshot. It is an evidence index, not a second control policy. The
normative rules live in [control-architecture.md](./control-architecture.md);
wire shapes live in [protocols.md](./protocols.md); context ownership lives in
[architecture.md](./architecture.md).

## Scope and commits

The current release branch contains the following development sequence:

```text
4d83e9f  fix spectra media runtime regressions
a86e9c5  fix spectra media runtime regressions
037dca0  refactor spectra media route registry
534b70c  Merge SPECTRA media runtime fixes
```

Compared with `c3d13a5`, the synchronized implementation is **86 files changed,
4073 insertions and 915 deletions**. The merge is already on `main`; this page
keeps the behavioral summary close to the owner documents so future changes do
not rely on commit archaeology.

## Background and storage

- `registry-repository.ts`, `handlers/registry.ts` and
  `packages/nexus-kernel/src/storage/restricted-registry.ts` now persist a
  registry-v2 route record instead of maintaining independent hijack and safe
  lists.
- Exact `media:v1:*` fingerprints resolve before normalized `site:*` fallback;
  one fingerprint has one `direct | capture` route, user records outrank auto
  observations, and legacy data is migrated atomically.
- `eligibility-cache.ts` is an in-memory routing hint. Cache reads do not
  activate Capture, create offscreen work or change the badge color. Identity,
  runtime revision and document navigation invalidate stale entries.
- `runtime-loader.ts`, `upgrade-manager.ts` and `shortcuts.ts` provide
  identity-bound READY ensure for cold documents and re-injection after update.
  A timed-out or uncontrollable document is reported as a typed, consumed error.
- `control-coordinator.ts` and `handlers/audio.ts` serialize native/audio
  transactions and commit only actual readback. Remote commands use the same
  coordinator path rather than worker self-RPC or UI prediction.

## Content runtime and media writers

- `native-media-executor.ts` is the sole standard-media writer with event quiet
  windows, stable getter readback, and page-observation commits that do not echo
  a second write.
- `core/index.ts`, `initial-state.ts` and the runtime contract bind operations
  to document/generation/revision identity and keep active audio and video
  targets independent.
- `fullscreen-audio-handoff.ts`, `fullscreen-bridge.ts` and
  `trusted-activation-bridge.ts` preserve page-owned volume/mute baselines while
  invoking native fullscreen/PiP inside the trusted event stack. Actual native
  lifecycle state, not a requested boolean, is committed.
- `playback-rate-bridge.ts` and `page-playback-rate-bridge.ts` implement a
  site-scoped, one-shot official-player adapter after DOM readback failure.
  Unsupported sites remain structured `unsupported`; no generic MAIN patch or
  permanent page bridge is installed.
- `hotkey-listener.ts`, `hotkey-helpers.ts`, `toast.ts` and `osd.ts` give each
  shortcut one feedback owner. Keyup cancels repeat/timers/Toast inertia;
  refresh, bootstrap and snapshot synchronization are silent. Cross-tab target
  feedback keeps the standard Toast style and only adds focus-tab information.

## Popup, Options and remote UI

- `i18n-apply.ts`, locale tables, `dom-init.ts` and UI contract tests cover every
  toolbar, tab, reset, state and tooltip key. Missing keys use an observable
  fallback instead of rendering `undefined`.
- `registry-ui.ts`, `registry-helpers.ts`, `popup/card/init.ts` and the shared
  registry client render one revisioned route list in Popup and Options. Reset
  is literal `100%`/`1x`; restoring page-owned values is a separate operation.
- `visualizer/loop.ts` and `draw-viz.ts` consume only an already active
  processor through a generation-aware lease, one in-flight batch and a 15 Hz
  ceiling. Hidden or closed views release their own lease immediately.
- `remote/modal-renderer.ts` and `remote/ui-bindings.ts` validate QR image URLs,
  origin and authentication boundaries before rendering or accepting commands.
  Favicon projection uses supported browser URL rules and does not request the
  unknown `_favicon` permission.

## Contracts and tests

- `registry.contracts.ts`, `spectra.protocol.ts`, content-runtime and UI-runtime
  contracts define the v2 envelopes, route/fingerprint payloads, runtime READY,
  actual ACK and projection boundaries.
- Added/updated tests cover eligibility cache migration and precedence, registry
  v2, native media stable ACK, shortcuts, runtime readiness, upgrade injection,
  UI/i18n contracts, visualizer lifecycle, remote security and browser smoke.
- Current verification on 2026-07-19: **371 unit tests passed**, **23 smoke tests
  passed**, with typecheck, lint and build passing. The older regression report's
  345/21 counts are retained only as historical baseline numbers.

## Maintenance rule

When a future change alters one of these boundaries, update the owning section
first, add or adjust its contract/regression test, then append a dated evidence
entry here. Do not create a second site-capability list, UI snapshot authority,
Toast owner or runtime readiness protocol in a feature-specific document.
