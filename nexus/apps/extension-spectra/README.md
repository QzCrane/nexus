# SPECTRA

SPECTRA is a Chrome Manifest V3 extension for audio, video, playback, hotkey, and optional authenticated mobile-remote control.

This README is an entrypoint. Current behavior is defined by the linked owner documents and executable contracts.

## Capability overview

### Audio

- effective volume from 0–800%;
- 10-band equalizer at 32 Hz–16 kHz;
- compressor, bass, mono, pan, and delay controls;
- separate media-mute and tab-mute state;
- processing resources created only when a non-neutral audio feature needs them.

### Playback and video

- playback speed, pitch preservation, play/pause, seek, loop, markers, and A/B loop when supported by the current media;
- reversible rotation, mirror, fill, filter, and dim effects;
- Picture-in-Picture and fullscreen through standard browser lifecycle rules;
- visible-frame screenshots when the current target is capturable.

### Remote control

- explicit QR pairing;
- HMAC-SHA-256 authentication before state or commands are exchanged;
- commands bound to the selected session and tab;
- disclosed PeerJS, STUN, and TURN network dependencies.

### Settings and interaction

- local global and per-site preferences;
- configurable hotkeys;
- translated product surfaces;
- one acknowledged state projection shared by Popup and authenticated remote clients.

A page or browser may not expose every operation. SPECTRA reports unsupported or failed operations instead of claiming universal compatibility.

## Development

From the repository root:

```bash
bun install --cwd nexus
bun run build
bun run lint
bun run typecheck
bun run verify
```

Load the generated unpacked extension through Chrome's extension-development page for local testing. Use the production release workflow for store artifacts.

## Chrome Web Store

Add the canonical product listing URL after publication. The Chrome Web Store homepage is not a product install link and is intentionally not used here.

## Engineering documentation

- [Control architecture](docs/control-architecture.md): capability strategy, writers, acknowledgement semantics, and release invariants.
- [Runtime protocols](docs/protocols.md): cross-context envelopes, state flow, READY, and leases.
- [Runtime topology](docs/architecture.md): context ownership and loading boundaries.
- [Remote security](docs/remote-security.md): pairing, authentication, and network disclosure.
- [WebAudio source admission](docs/cors-data-flow.md): source eligibility and binding boundaries.
- [Roadmap](plan.md): proposed and unresolved work.
- [Historical archive](docs/_archive/2026-Q3/README.md): dated implementation and regression evidence.

## Privacy

SPECTRA has no advertising, analytics, telemetry, or developer-operated collection service. Settings and media processing remain local by default. The optional remote feature creates disclosed third-party network connections and sends a limited control projection only after authentication. See [PRIVACY.md](PRIVACY.md).

## Contribution boundary

Change a capability through its contract, implementation, tests, and owner documentation in one closure. Follow the [repository documentation map](../../docs/documentation-index.md) and [`rules.md`](../../../rules.md).

## License

MIT License. See [`../../LICENSE`](../../LICENSE).