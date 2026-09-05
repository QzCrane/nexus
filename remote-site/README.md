---
type: reference
status: stable
audience: contributor
owner: spectra-remote-site
last_reviewed: 2026-08-28
---

# SPECTRA remote site

This directory is the independently deployed static client for authenticated SPECTRA remote sessions. It is a release surface, not a general website and not an alternate extension implementation.

## Deployment contract

- Deploy this directory without HTML rewriting so `_headers` remains effective.
- JavaScript is served locally. `vendor/peerjs.min.js` is the workspace-owned PeerJS 1.5.5-derived JSON/DataChannel-only transport source consumed by both this page and the extension build; its declaration and MIT provenance remain beside it in `vendor/peerjs.min.d.ts` and `vendor/LICENSE.peerjs`.
- Pairing data is accepted from the URL fragment, moved immediately to tab-scoped `sessionStorage`, and authenticated with HMAC-SHA-256 before controls are enabled.
- CSP permits local assets plus the network destinations required for PeerJS signaling and WebRTC connectivity.
- The site contains no analytics, advertising, or favicon request.

The optional remote can still expose ordinary network metadata such as IP addresses and connection timing to Cloudflare Pages, PeerJS signaling, STUN, or TURN providers. The public privacy policy must disclose that physical traffic.

## Release gate

From the `nexus/` workspace, run the maintained live-remote check. The gate requires the deployed root route and every explicit HTML, JavaScript, CSS, and vendored asset to be byte-identical to this directory, validates MIME types, and compares the security headers declared in `_headers`. HTML fallbacks, injected scripts, mismatched assets, or redirects to another origin fail the gate.

## Transport update

When the transport changes:

1. change the canonical source, declaration, and license provenance together; do not restore a package copy, CDN script, browser global, MediaConnection, BinaryPack, or Raw/binary serializer;
2. preserve the signaling and `Peer`/`DataConnection` lifecycle ABI, mandatory JSON serialization, bounded lost/signaling queues, disposal fences, and the 16 KiB UTF-8 inbound/outbound limit;
3. run syntax/module checks plus the extension data-only, remote-security, reconciliation, and command suites;
4. build the extension and verify its `peerjs-vendor.js` is derived from this source, remains reachable only through the declared Remote loader edge, and contains no retired runtime dependency;
5. run the installed-Chromium Remote lifecycle gate and the separate live deployment/provider gate;
6. reconcile [`../nexus/apps/extension-spectra/PRIVACY.md`](../nexus/apps/extension-spectra/PRIVACY.md), [`../nexus/apps/extension-spectra/docs/security/remote-control.md`](../nexus/apps/extension-spectra/docs/security/remote-control.md), and store disclosures before release.
