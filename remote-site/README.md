---
type: reference
status: stable
audience: contributor
owner: spectra-remote-site
last_reviewed: 2026-10-25
---

# SPECTRA remote site

This directory is the independently deployed static client for authenticated SPECTRA remote sessions. It is a release surface, not a general website and not an alternate extension implementation.

## Deployment contract

- Deploy this directory without HTML rewriting so `_headers` remains effective.
- JavaScript is served locally. `vendor/peerjs.min.js` is a committed projection of the extension-owned PeerJS 1.5.5-derived JSON/DataChannel-only transport source consumed by both this page and the extension build; its declaration and MIT provenance are projected beside it in `vendor/peerjs.min.d.ts` and `vendor/LICENSE.peerjs`.
- Pairing data is accepted from the URL fragment, moved immediately to tab-scoped `sessionStorage`, and authenticated with HMAC-SHA-256 before controls are enabled.
- CSP permits local assets plus the network destinations required for PeerJS signaling and WebRTC connectivity.
- The site contains no analytics, advertising, or favicon request.

The optional remote can still expose ordinary network metadata such as IP addresses and connection timing to Cloudflare Pages, PeerJS signaling, STUN, or TURN providers. The public privacy policy must disclose that physical traffic.

## Remote projections

`dist/protocol.js` and `vendor/` are generated, committed projections, never hand-written files. The protocol exposes `globalThis.SpectraRemoteProtocol` with the wire version, challenge payload, HMAC proof, and wire validators, and `index.html` loads it before `app.js`.

- Protocol owner source: `nexus/apps/extension-spectra/src/remote/protocol.ts` plus `@nexus/contracts` (`REMOTE_PROTOCOL_VERSION`).
- Transport owner source: `nexus/apps/extension-spectra/vendor/peerjs/` (`peerjs.min.js`, `peerjs.min.d.ts`, `LICENSE.peerjs`); this directory must never become a second source of truth.
- Regenerate from `nexus/`: `bun run generate:remote-projection`. Do not edit `dist/protocol.js` or `vendor/` by hand, and do not add a second copy of the wire surface to `app.js`.
- Gate: architecture `verify` fails when any projection is stale, when the page stops loading `dist/protocol.js` before `app.js`, or when `app.js` re-own protocol primitives.

## Release gate

From the `nexus/` workspace, run the maintained live-remote check. The gate requires the deployed root route and every explicit HTML, JavaScript, CSS, and vendored asset — including `dist/protocol.js` — to be byte-identical to this directory, validates MIME types, and compares the security headers declared in `_headers`. HTML fallbacks, injected scripts, mismatched assets, or redirects to another origin fail the gate. Regenerate the remote projections before deploying whenever an owner source changes.

## Transport update

When the transport changes:

1. change the canonical source, declaration, and license provenance together in `nexus/apps/extension-spectra/vendor/peerjs/`, regenerate this directory, and do not restore a package copy, CDN script, browser global, MediaConnection, BinaryPack, or Raw/binary serializer;
2. preserve the signaling and `Peer`/`DataConnection` lifecycle ABI, mandatory JSON serialization, bounded lost/signaling queues, disposal fences, and the 16 KiB UTF-8 inbound/outbound limit;
3. run syntax/module checks plus the extension data-only, remote-security, reconciliation, and command suites;
4. build the extension and verify its `peerjs-vendor.js` is derived from the extension-owned source, remains reachable only through the declared Remote loader edge, and contains no retired runtime dependency;
5. run the installed-Chromium Remote lifecycle gate and the separate live deployment/provider gate;
6. reconcile [`../nexus/apps/extension-spectra/PRIVACY.md`](../nexus/apps/extension-spectra/PRIVACY.md), [`../nexus/apps/extension-spectra/docs/security/remote-control.md`](../nexus/apps/extension-spectra/docs/security/remote-control.md), and store disclosures before release.
