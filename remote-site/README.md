# SPECTRA Remote Site

Static Cloudflare Pages client for authenticated SPECTRA remote sessions.

- Deploy this directory without HTML rewriting so `_headers` is applied.
- JavaScript must remain local. `vendor/peerjs.min.js` is PeerJS 1.5.5 copied from the extension's locked dependency; its MIT notice is in `vendor/LICENSE.peerjs`.
- Pairing data is accepted only from a URL fragment, moved to tab-scoped `sessionStorage`, and authenticated with HMAC-SHA-256 before controls are enabled.
- CSP permits the local scripts plus PeerJS signaling at `0.peerjs.com`. PeerJS uses Google STUN and PeerJS TURN for WebRTC connectivity; no favicon or analytics request is made.

The SPECTRA release gate runs `bun run check:spectra-remote-live` from the `nexus` workspace. It requires the deployed `/` route and every explicit HTML, JavaScript, CSS, and vendored PeerJS asset to be byte-identical to this directory, checks their MIME types, and compares all security headers declared in `_headers`. HTML fallbacks and redirects to another origin fail the gate.

After updating PeerJS, copy both the minified distribution and license from the locked package, run `node --check app.js`, and run the extension's `test/remote-security.spec.ts`.
