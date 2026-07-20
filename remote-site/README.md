---
type: reference
status: stable
audience: contributor
last_reviewed: 2026-07-20
---

# SPECTRA remote site

This directory is the independently deployed static client for authenticated SPECTRA remote sessions. It is a release surface, not a general website and not an alternate extension implementation.

## Deployment contract

- Deploy this directory without HTML rewriting so `_headers` remains effective.
- JavaScript is served locally. `vendor/peerjs.min.js` must match the extension's locked PeerJS dependency; its license notice remains in `vendor/LICENSE.peerjs`.
- Pairing data is accepted from the URL fragment, moved immediately to tab-scoped `sessionStorage`, and authenticated with HMAC-SHA-256 before controls are enabled.
- CSP permits local assets plus the network destinations required for PeerJS signaling and WebRTC connectivity.
- The site contains no analytics, advertising, or favicon request.

The optional remote can still expose ordinary network metadata such as IP addresses and connection timing to Cloudflare Pages, PeerJS signaling, STUN, or TURN providers. The public privacy policy must disclose that physical traffic.

## Release gate

From the `nexus/` workspace, run the maintained live-remote check. The gate requires the deployed root route and every explicit HTML, JavaScript, CSS, and vendored asset to be byte-identical to this directory, validates MIME types, and compares the security headers declared in `_headers`. HTML fallbacks, injected scripts, mismatched assets, or redirects to another origin fail the gate.

## Dependency update

When PeerJS changes:

1. update the locked workspace dependency through Bun;
2. copy the exact minified distribution and license into `vendor/`;
3. verify its public/signaling/WebRTC ABI remains compatible with both extension and remote builds;
4. run `node --check app.js`;
5. run the extension remote-security tests and the live deployment gate;
6. reconcile [`../nexus/apps/extension-spectra/PRIVACY.md`](../nexus/apps/extension-spectra/PRIVACY.md), [`../nexus/apps/extension-spectra/docs/remote-security.md`](../nexus/apps/extension-spectra/docs/remote-security.md), and store disclosures before release.