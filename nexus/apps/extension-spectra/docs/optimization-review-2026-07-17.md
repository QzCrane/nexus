# SPECTRA native-first control review — 2026-07-17

This report records the product outcome and release evidence for the native-first
control follow-up. The normative design remains
[`control-architecture.md`](./control-architecture.md); this file does not define
a second policy.

## Product outcome

- The webpage, Popup, authenticated remote controller and hotkeys are equal
  control surfaces. They submit typed intents to one Background coordinator and
  receive the same read-back `ControlSnapshot`.
- Main volume and playback speed stay native page controls. WebAudio and Capture
  cannot impersonate volume, mute, speed, playback, seek, loop, PiP or fullscreen.
- Boost and DSP remain independent enhancements. A page volume change updates
  native base volume without silently clearing Boost.
- The user sees outcomes and errors, not implementation modes. Capture is an
  internal last-resort processor for explicit full-output DSP only.
- Untouched pages keep native constructor/descriptor identity and create no
  AudioContext, offscreen processor, analyser or periodic IPC.

## Exhaustive control and source-algorithm adjudication

The contract owns all 50 control capabilities:

- 17 native-only;
- five hybrid extension-state/native-writer;
- 26 augmentation-only;
- two observation-only.

The tooling-only source catalog owns 34 implementation algorithms (`ALG-001`
through `ALG-034`). Each row records the source file and symbol anchor, native or
augmentation decision, MAIN admission, success proof, recurring work and a
performance ceiling. `scripts/verify/check-spectra-control.js` fails the release
if an ID, source anchor, capability coverage, documentation mirror or strategy
boundary drifts.

The decisive rule is per capability, not per page:

```text
observe actual state
  -> exact standard DOM / Chrome primitive
  -> one-shot allowlisted official player API, only where declared
  -> reversible capability-owned augmentation, only where native equivalence is absent
  -> structured unsupported result
```

There is no generic MAIN runtime, constructor/prototype/descriptor patch,
`createElement` wrapper, History patch or page AudioContext interception.

## Concrete implementation locations and purpose

| Location | Purpose |
| --- | --- |
| `packages/contracts/src/control.contracts.ts` | Exhaustive capability policy, native/augmentation adjudication and per-capability ACK admission. A known strategy name is insufficient if the exact field/operation does not admit it. |
| `scripts/verify/spectra-control-algorithm-catalog.mjs` | Runtime-free catalog of all 34 source algorithms, anchors, success evidence and performance boundaries. |
| `scripts/verify/check-spectra-control.js` | Release gate for all 50 capabilities, all 34 source algorithms, one DOM writer, forbidden interception and production loading topology. |
| `src/background/control-coordinator.ts` | Serializes every surface, rejects stale generations, performs compensation for compound operations and publishes the sole field-level actual snapshot. |
| `src/content/logic/native-media-executor.ts` | Sole standard-media writer. Native setters are acknowledged only after the matching event/quiet window, two bounded stabilization boundaries and getter readback. |
| `src/content/logic/content-control-policy.ts` | Narrow Content projection of DOM/CSS/Overlay strategies; prevents the full planner and full contract policy from entering every page. |
| `src/content/core/media-registry.ts` | Event-driven media identity, source revision, independent active-media/active-video selection and pre-bind CORS evidence. |
| `src/background/main-runtime-manager.ts` | One-shot allowlisted official player call for only volume, media mute and speed after retryable DOM failure; installs no bridge or listener. |
| `packages/features/audio-engine/src/webaudio/controller.ts` | Page-lifetime WeakMap singleton for each `MediaElementSourceNode`, complete-coverage admission and safe CORS evidence. |
| `packages/features/audio-engine/src/AudioGraphRouter.ts` | Sparse DSP graph, normalized actual snapshot, latest-value queue, in-place continuous parameter ramps and topology-only crossfade. |
| `src/offscreen/audio-host.ts`; `src/background/offscreen-coordinator.ts` | Candidate-gated Capture processor and the single offscreen document shared by audio and remote leases. |
| `src/popup/card/messaging.ts`; `src/background/remote-commands.ts` | Project only coordinator actual state; audio-session events contribute lifecycle and cannot overwrite field values. |
| `src/popup/visualizer/loop.ts`; `src/background/visualizer-subscriber-registry.ts` | One in-flight Popup scheduler plus generation-aware, multi-consumer analyser leases and tombstones. |
| `src/remote/qr-generator.ts` | Local SVG QR encoding for the same fragment-secret pairing URL, replacing the larger transitive QR package without network generation. |

## Algorithm-level decisions

- Native media: base volume, media mute, speed, pitch preservation, play/pause,
  seek, loop, PiP and fullscreen use only their standards-owned APIs. Retryable
  stable-readback failure may enter the declared official adapter for base
  volume, media mute or speed; activation, policy, stale identity and security
  failures are terminal.
- Browser operations: tab mute/pin, visible-tab screenshot, Popup/Options and
  HTTP(S) navigation use Chrome APIs with actual result or getter verification.
- Audio enhancement: Boost, EQ, bass, compressor, mono, pan and delay have no
  equivalent native primitive. They use a proven-complete media graph or an
  explicitly authorized full-output Capture processor. Neutral nodes are absent.
- Video enhancement: rotation, mirror, fill and filter use removable owned CSS;
  dim uses one owned four-region overlay. Native playback/layout objects are not
  patched.
- Media-source algorithms: frame step, markers and A/B own only bounded
  estimation/index/state. Their final timeline mutation remains the canonical
  native seek with same-source actual readback.
- Observation: page events and Visualizer cannot acquire a processing path.
  Popup/remote observation leases load only the event-driven document registry
  and release after the last consumer.

## Performance result

Production loading now keeps the two Content artifacts isolated while extension
pages share private ESM chunks. Runtime-only packages declare
`"sideEffects": false`; the Content runtime aliases narrow contract, audio-engine
and kernel facades. Continuous UI fields coalesce to at most 20 sends/second,
storage trails by 250 ms, and the audio graph keeps one active plus one latest
pending apply.

The local QR encoder reduced production JavaScript from 520.8 KiB to 507.0 KiB.
The current deterministic candidate measures:

| Metric | Bytes | KiB |
| --- | ---: | ---: |
| Default startup closure | 228,577 | 223.2 |
| All production JavaScript | 519,215 | 507.0 |
| Complete production dist | 626,435 | 611.8 |
| Background closure | 222,319 | 217.1 |
| Bootstrap closure | 6,258 | 6.1 |
| Lazy Content runtime | 138,205 | 135.0 |
| Popup closure | 176,460 | 172.3 |
| Unified offscreen closure | 135,050 | 131.9 |
| Options closure | 96,356 | 94.1 |

The enforced transitive ceilings are now 225 KiB startup, 515 KiB JavaScript,
620 KiB dist, and 220/10/140/175/135/95 KiB for Background/bootstrap/Content/
Popup/offscreen/Options respectively. They leave roughly 1–4% headroom.

The original historical target (complete dist no more than 542.85 KiB and
106.05/131.25/97.65 KiB Content/Popup/offscreen closures) is **not achieved**.
Those numbers described the smaller pre-contract/pre-coordinator product and
cannot be reported as passed by changing the measurement to entry stubs. The
current release keeps the security, compatibility and actual-readback code and
records this size exception explicitly instead of weakening validation or
hiding transitive chunks.

## Final release evidence

- The complete orchestrator passed all 14/14 gates and promoted the validated
  archive.
- Architecture verification passes, including the 50-capability and
  34-algorithm source catalog. Biome and all four relevant workspace typechecks
  pass.
- The unit/contract/runtime suite passes 308 tests with 2,815 assertions across
  49 files.
- Chrome integration covers untouched-page transparency, side-effect-free
  status reads, bidirectional page/Popup state, WebAudio/Capture transitions,
  single offscreen ownership, SPA/fullscreen/source identity, Visualizer idle
  behavior and service-worker restart.
- The QR replacement has a boundary test proving a local SVG data URL encodes
  the fragment-secret pairing URL without placing the secret in SVG metadata.
- Chrome integration passes 17/17 against the development build and another
  17/17 against the extracted production ZIP.
- Dependency audit reports no vulnerabilities. The production remote page
  matches local bytes, MIME types and all release-gated security headers.
- The deterministic 59-file archive is 633,441 bytes and expands to the exact
  626,435-byte production dist. Its SHA-256 is
  `517c32ef5aeaf532329da3350bf5fd2080d072c1a5225926b05a3da57832b83a`.

GitNexus graph queries were attempted during the review but the configured MCP
transport returned `Transport closed`. Graph-It-Live indexing also reported an
uninitialized call-graph query surface after workspace indexing. The release
therefore treats direct source anchors, exhaustive TypeScript records, static
architecture checks and executable browser/tests as the evidence owners; it
does not claim an unavailable graph result.
