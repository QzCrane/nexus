---
type: reference
status: stable
audience: developer
last_reviewed: 2026-07-24
---

# 05. Control state (Field states, volume/mute, audio processing)

> 主题 owner 段: §10 Control state · §11 Volume and mute · §12 Audio processing
> 完整目录: [control-architecture.md](../control-architecture.md)

## §10 Control state

The background `ControlCoordinator` owns intent ordering, per-field revisions and the authoritative snapshot. Content owns the current document's media registry and executes document APIs. Offscreen owns acknowledged Capture processors.

```ts
interface ControlFieldState<T> {
  desired: T | null;
  actual: T | null;
  // Captured before a failed standard writer attempt and consumed only on a
  // same-writer restore of the same field.
  restoreBaseline?: T;
  revision: number;
  phase: 'idle' | 'applying' | 'applied' | 'error';
  strategy:
    | 'observe'
    | 'page-native'
    | 'dom-native'
    | 'chrome-native'
    | 'extension-state'
    | 'extension-css'
    | 'extension-overlay'
    | 'media-webaudio'
    | 'capture'
    | 'unsupported';
  coverage: 'full' | 'active-target' | 'partial' | 'opaque';
  controlled: boolean;
  intentId?: string;
  lastError: ControlError | null;
}
```

Every intent and ACK is bound to `tabId + documentId + generation + revision + intentId`. A late result cannot commit to a newer document or field revision.

Every intent also carries `requestedCoverage: 'active-target' | 'full'`.
The executor cannot infer or widen it from the current audio mode. Native page
observations are always `active-target`; a target-level request cannot enter
Capture. `full` admits only a strategy that proves full/opaque coverage and is
explicitly listed for that capability.

### §10.1 Echo correlation

DOM writes use per-target, per-field tokens:

```text
{ intentId, fieldRevision, expectedValue, tolerance }
```

A matching event is the acknowledgement of the pending write. A non-matching page event is a new page intent and receives a new revision. Time-window booleans such as `settingByPlugin` are forbidden.

For `volumeBase`, `mediaMuted`, and `speed`, a request-local `page-native`
probe runs before the DOM fallback. Its exact page-controller getter is both the
baseline source and ACK; a write mismatch is restored through that same writer.
Once a field is owned, its writer identity is stable until release. Normal DOM
events still drive page-to-extension observation, but the observer re-reads the
page semantic getter before committing when that getter exists.

### §10.2 Processor handoff without double processing

The authoritative state transition is transactional, but Chrome cannot promise a
sample-accurate crossfade between a page `AudioContext` and `tabCapture`.
Acquiring a tab stream can redirect local tab output before an offscreen graph is
ready, and leaving the old DSP active would feed already-processed audio into the
new Capture DSP. The product guarantee is therefore no double gain/DSP, no false
active ACK, bounded neutral handoff, and restoration of the last stable actual
configuration on failure.

For Media WebAudio -> Capture:

1. Record the last acknowledged Media WebAudio configuration.
2. ACK a transparent WebAudio route before requesting the whole-tab stream, so
   Capture cannot receive already-processed audio.
3. Build the Capture graph behind a closed gate, verify its stream, context,
   graph signature and normalized actual configuration, then open the gate.
4. Commit `actualMode=capture` only after the current-generation host ACK.
5. On failure, reapply and verify the recorded Media WebAudio configuration; if
   restoration also fails, expose bypass plus a structured error.

For Capture -> Media WebAudio, ACK Capture at unity first, prove complete
registry coverage, bind/reuse every page-lifetime source, apply and verify the
candidate graph, then stop Capture. While Capture still owns tab output it acts
as a unity relay for the candidate WebAudio route, so the DSP is applied exactly
once. Capture -> Capture replacement is the only transition with two independent
offscreen gates; both gates receive the same near-future wall-clock cutoff and
the old processor is disposed only after that boundary. This is a best-effort
hard handoff, not a sample-synchronous crossfade claim.

Capture follows the existing generation tombstone and offscreen lease rules. A
processor is never active before the current-generation host ACK. The offscreen
document is the generation authority while it survives a Background or Content
replacement: an idle host rejects a START at or behind its STOP tombstone with
`stale_capture_intent` and the authoritative generation. Background adopts that
value and retries exactly once inside the same per-tab serialized transaction.
This bounded reconciliation cannot require repeated user input, cannot erase
the tombstone, and cannot displace a newer active processor.

## §11 Volume and mute

The product exposes one effective volume while persistent control state keeps
the two writer domains explicit internally:

```text
volumeBase = 0..100
boost = 1..8
AudioConfig.volume = clamp(volumeBase * boost, 0, 800)
effective output ~= volumeBase / 100 * boost
```

- The exact page controller owns `volumeBase` or `mediaMuted` when its paired getter/setter proves semantic readback; otherwise standard DOM owns the field. Only one selected native writer applies or restores it.
- Popup, remote and hotkeys submit only `effective-volume 0–800`; the coordinator performs the split and atomic rollback.
- A page volume change updates the public effective volume and resets a non-neutral hidden Boost to 1 in the same commit.
- Media mute preserves the numeric volume and is applied only through the selected media writer; processor state remains unchanged.
- Tab mute is a separate Chrome-native field and never changes media mute.
- `volume_up/down/set` and one-release `gain/boost` aliases all change the same effective-volume state.
- At or below 100, the transaction sets `boost=1`, releases any no-longer-needed processor, and returns control to the selected native page/DOM writer. Above 100, `volumeBase=100` and only hidden Boost carries the excess.
- Same-region changes touch one writer; only a crossing of the native 100% boundary touches both. Repeated acknowledged values do no Content IPC, revision or storage write.
- No strategy inserts an implicit limiter. Compressor is an explicit user capability.

The desired/actual transaction remains pending until both writer stages ACK.
Capture, Media WebAudio and neutral processor-release strategies in the compound
field ACK project their matching lifecycle immediately, without waiting for a
later event-loop delivery. A transition back to `<=100` releases the processor
before committing the native writer. Popup presentation follows the atomic
value-and-color rule owned by [§19 User experience](03-ui-and-boundaries.md#19-user-experience).

Legacy values migrate idempotently:

- `volume <= 100`: `volumeBase=volume`, `boost=1`;
- `volume > 100`: `volumeBase=100`, `boost=volume/100`.

## §12 Audio processing

EQ, Bass, Compressor, Mono, Pan, Delay and Boost have no generic HTMLMediaElement implementation.

- If every source in the requested scope is safe to bind, use one document DSP graph fed by page-lifetime-unique `MediaElementSourceNode` instances.
- If any required source is unsafe, inaccessible or opaque, use Capture.
- Never set `crossOrigin` after resource selection and never call `createMediaElementSource()` as a probe.
- Same-origin, `data:`, origin-owned `blob:`/MediaSource and the exact resource successfully loaded with pre-load CORS mode can be safe. No page control surface is source-binding evidence; unknown cross-origin media goes directly to Capture.
- A bound `MediaElementSourceNode` is never closed and rebound. Exit returns it to a transparent route.

### §12.1 Media WebAudio complete-coverage admission

Media WebAudio success is a three-stage proof over one immutable registry snapshot:

1. `assessMediaSourceCoverage` prospectively evaluates every registered media element. An empty registry, one unselected resource, or any unsafe resource means full coverage is false; one safe source cannot hide an unknown sibling.
2. `WebAudioController.ensureAttached` must confirm the unique page-lifetime source for every element. An already-bound active source is success, not a failed second attach. A source-creation exception is remembered for that current resource so the next policy evaluation selects Capture instead of retrying forever.
3. `hasCompleteCoverage` confirms that every prospectively safe element is actually connected to the shared router before `applyConfig` may ACK active. `sourceCount >= 1` alone is never coverage evidence.

`MediaRegistry` registration, removal, `loadedmetadata` and play events trigger policy reconciliation. Therefore an SPA that adds an unselected/unsafe media element immediately invalidates Media WebAudio full coverage and moves to Capture or a structured error. Removing an element disconnects its source node from the shared input to eliminate unnecessary DSP work; reinsertion reconnects the same page-lifetime node and never calls `createMediaElementSource()` a second time.

Concrete ownership and purpose:

| Location | Purpose |
| --- | --- |
| `packages/features/audio-engine/src/webaudio/controller.ts` | Own prospective source assessment, unique binding, actual complete-coverage readback, current-resource failure memory and route disconnect/reconnect. |
| `src/content/logic/policy-executor/index.ts` | Treat the legacy internal `NATIVE_WEBAUDIO` token as Media WebAudio only when the entire current registry is prospectively safe and has no known bind failure; otherwise select Capture. The name grants no native or MAIN authority. |
| `src/content/logic/mode-executor.ts` | Recheck the registry immediately before transition, confirm every source after binding, bypass partial graphs and preserve/restore the stable Capture path on failure. |
| `src/content/core/lifecycle/media-observer.ts` | Reconcile policy from event-driven registry changes; no command-time document scan or polling. |
| `packages/features/audio-engine/src/AudioGraphRouter.ts` | Count only currently connected sources and allow a page-lifetime source node to reconnect after registry reinsertion. |

The shared graph creates only active features:

```text
sources -> mix bus -> master gain
                    -> [Bass]
                    -> [non-zero EQ bands]
                    -> [Compressor]
                    -> [Mono mixer]
                    -> [StereoPanner]
                    -> [Delay]
                    -> output
                    -> optional analyser tap
```

Canonical DSP parameters are product behavior, not executor-local defaults:

| Algorithm | Exact definition |
| --- | --- |
| Boost | linear master `boostGain` `1–8`; media mute never enters the processor contract and no gain-zero substitute or implicit limiter exists |
| 10-band EQ | peaking filters at `32/64/125/250/500/1000/2000/4000/8000/16000Hz`, `Q=1.4`, each `-12..+12dB`; zero bands allocate no node |
| Bass | one `lowshelf`, `200Hz`, `+10dB`; disabled allocates no node |
| Compressor | threshold `-24dB`, knee `30dB`, ratio `12:1`, attack `0.003s`, release `0.25s`; disabled is a physical bypass |
| Mono | `M=0.5L+0.5R`, then `L'=M`, `R'=M`; disabled allocates no splitter/merger |
| Pan | browser equal-power `StereoPanner`, `-1..1`, after Mono; zero allocates no panner |
| Delay | `0–500ms`, 100% wet; zero allocates no delay node |
| Visualizer | post-processor master tap, `fftSize=256`/128 byte bins, only while explicitly subscribed |

Topology signatures include enabled Bass/Compressor/Mono, non-zero EQ band
indices, and zero/non-zero Pan and Delay. Parameter-only EQ, Pan, Delay and
Boost changes reuse the lane and ramp for `15ms`. Topology changes build a
candidate and use a `40ms` complementary linear crossfade
(`old + candidate = 1`) before destroying the old lane; this is not
an equal-power mix and cannot double gain.

- Mono is deterministic and Pan remains after Mono.
- Non-zero Delay amount changes ramp the existing `DelayNode`; only the
  zero/non-zero boundary allocates or removes the node through a candidate
  lane/crossfade. The 20 Hz input cap plus 15ms ramp bounds modulation work.
- Compressor-off is a physical bypass. No neutral feature node remains in the main chain.
- Analyser is a subscription tap, never a permanent output node. A visualizer subscription cannot start an otherwise absent processor.
