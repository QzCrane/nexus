# SPECTRA

SPECTRA is a Chrome Manifest V3 extension for audio, video, playback, hotkey, and optional authenticated mobile-remote control.

This README is a product and developer entrypoint. Current behavior is defined by executable contracts/source/tests and the [SPECTRA documentation owners](docs/README.md).

## Capability overview

### Audio

- effective volume from 0–800%;
- 10-band equalizer at 32 Hz–16 kHz;
- compressor, bass, mono, pan, and delay controls;
- separate media-mute and tab-mute state;
- processing resources created only when a non-neutral audio feature needs them.

### Playback and video

- playback speed, pitch preservation, play/pause, seek, loop, markers, and A/B loop when supported by current media;
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

The repository is pinned to **Bun 1.3.14**. From the repository root:

```bash
bun install
bun run build
bun run lint
bun run typecheck
bun run verify
bun run docs:check
```

Load the generated unpacked extension through Chrome's extension-development page for local testing. Use the production release workflow for store artifacts.

## Documentation

- [Documentation map](docs/README.md)
- [Control architecture](docs/control/README.md)
- [Runtime protocols](docs/reference/protocols.md)
- [Runtime architecture](docs/architecture/runtime.md)
- [Remote security](docs/security/remote-control.md)
- [Media WebAudio admission](docs/architecture/media-source-admission.md)
- [Roadmap](docs/roadmap.md)
- [Historical archive](docs/_archive/2026-Q3/README.md)

## Privacy

SPECTRA has no advertising, analytics, telemetry, or developer-operated collection service. Settings and media processing remain local by default. The optional remote feature creates disclosed third-party network connections and sends a limited control projection only after authentication. See [PRIVACY.md](PRIVACY.md).

## Chrome Web Store

Add the canonical product listing URL after publication. The Chrome Web Store homepage is not a product install link and is intentionally not used here.

## Contribution boundary

Change a capability through its contract, implementation, tests, owner documentation, and release evidence in one closure. Follow the [repository documentation architecture](../../docs/README.md) and [`rules.md`](../../../rules.md).

## License

MIT License. See [`../../LICENSE`](../../LICENSE).