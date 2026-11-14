---
type: reference
status: stable
audience: contributor
owner: product-research
last_reviewed: 2026-11-14
---

# NEXUS research

Research documents are dated evidence and hypotheses. They help choose what to build; they do not define current implementation, permissions, performance, compatibility, or release status.

## Current evidence sets

- [SPECTRA volume audible-path re-audit v2 2026-11-14](2026-11-14-spectra-volume-audible-path-reaudit.md): in-place revision of the same-day v1. It overturns v1's core finding: the `documentOutput` to `outputLevel` path is already wired in HEAD through `nativeAudioAbsent` and the admitted Capture graph, so the residual gap is real-site end-to-end evidence, not a physical capability boundary. It reinstates the 11-05 regression audit as the authoritative decision source (`SCTRL-053`, the user-authorized removal of global graph interception, and six open follow-ups), corrects the snapshot-count attribution, and replaces the two-way D3 with a three-branch plan plus a current-product real-site probe. It also finds the already-written real-site smoke case gated by `SPECTRA_DOCUMENT_OUTPUT_LIVE_URL`, so D2 becomes running an existing test rather than designing a probe. Two local Chrome 157 runs (production-graph RMS and built-extension fixture round) are recorded in `evidence/2026-11-14-local-document-output-built-extension-proof.json` as `[E-local-extension]`, `realSite: false`, and explicitly not claimed as real-site evidence.
- [SPECTRA documentation quality audit 2026-11-09](2026-11-09-spectra-documentation-quality-audit.md): hard defects (three conflicting invariant totals, an EPR rule that contradicts the control owner, four competing owner tables), unverifiable prose (241 unnumbered must/never statements), and the structural gaps (no invariant index, no failure catalog, evidence contract defined but never cited by the normative layer).
- [SPECTRA live volume regression audit 2026-11-05](2026-11-05-spectra-live-volume-regression-audit.md): branch and dirty scope, audio-owner routing gaps, limits of existing verification, and open reproduction/repair acceptance.
- [SPECTRA tab lifecycle and Popup closure 2026-11-02](2026-11-02-spectra-tab-lifecycle-popup-closure.md): dynamic card membership, immediate structure, physical observation order, retirement and scene-speed repair evidence.
- [SPECTRA PiP readback mismatch 2026-11-02](2026-11-02-spectra-pip-readback-root-cause.md): why the picture-in-picture window closed immediately after opening — the W3C §3.4 exit algorithm triggered by re-adding `disablePictureInPicture` in a `finally` block — together with the session-scoped attribute ownership repair and the write/acknowledgement/proof separation it depended on.

- [`../_archive/market-research.md`](../_archive/market-research.md): legacy long-form HALO competitor research collected in 2025. Preserve as source material, but revalidate every dynamic number, price, policy, product capability, issue count, and user-count claim before using it in a current decision.
- [HALO research index](../../apps/extension-halo/docs/research/README.md): application-specific market and gap evidence.
- [SPECTRA archived evidence](../../apps/extension-spectra/docs/_archive/2026-Q3/README.md): dated implementation, regression, and release snapshots.
- [SPECTRA architecture audit 2026-10-26](2026-10-26-spectra-architecture-audit.md): consolidated state-machine audit — 67 registered findings (44 fixed, 22 revoked), five state machines, the fate of design v4, 15 invariants with current verdicts, G1–G8, and the open-item register. Replaces 14 documents that lived outside version control.
- [SPECTRA volume latency 2026-10-28](2026-10-28-spectra-volume-latency.md): root cause of the "bar does not follow the thumb" regression, per-millisecond latency budget, the 16.7ms / ~20ms physical floors, and the repair evidence. Supersedes the diagnosis below.
- [Dependency upgrade 2026-10-28](2026-10-28-dependency-upgrade.md): both dependency domains and the Bun runtime moved to the day's latest, with the two deliberate holds (`puppeteer-floor`, TS 6 compiler API), three pre-existing defects the upgrade exposed, and same-workload artifact deltas.
- [SPECTRA repeated 100–110 volume display stall](2026-09-23-spectra-volume-boundary.md): baseline diagnosis, evidence limits, and the continuous-feedback repair boundary. **Superseded by the 2026-10-28 entry** — the 2026-09-23 repair changed only the freeze trigger, not the value source.
- [SPECTRA test-value ledger](2026-09-23-spectra-test-value-ledger.md): frozen test census and KEEP/MERGE/REWRITE/DELETE disposition evidence for the cleanup wave.
- [SPECTRA control liveness follow-up](2026-09-23-spectra-control-liveness.md): post-reload hangs, bounded runtime reuse probes, and outstanding live-profile verification.
- [SPECTRA live and recorded media route isolation](2026-09-23-spectra-douyin-route-isolation.md): live-player target theft, hostname-rule collisions, and physical validation boundaries.

## Real-site evidence 2026-11-14 (`[E-current]`)

These files close out [volume audible-path re-audit](2026-11-14-spectra-volume-audible-path-reaudit.md) §13.
They were captured against a freshly rebuilt production artifact of HEAD `0b907ee0`.
The browser was local Chrome 157.0.8103.39, loaded through CDP `Extensions.loadUnpacked`.

- [Media shape survey](evidence/2026-11-14-real-site-media-shape-survey.json): Huya 102411 exposes a video-only `MediaStream`. Three Douyin live rooms carry an audio track. `www.douyin.com` was captcha-blocked. It also records why the default 800x600 test viewport made every `IntersectionObserver` area zero.
- [Huya document-output control](evidence/2026-11-14-real-site-document-output-huya.json): two reproducible pre-fix failures, then `3 pass / 65 expect()`. Product-output analyser RMS is zero for volume-0 and mute, and nonzero for volume-70, unmute and shortcut.
- [Douyin dom-native audibility](evidence/2026-11-14-real-site-dom-native-audibility-douyin.json): `volumeBase 0 -> 100` moves `element.volume 0 -> 1` and tab audio RMS `0 -> 0.1449` within one run. The site's own volume number follows from 0 to 100 through the native `volumechange` event.

The only code change in that batch is the real-site case's viewport in `apps/extension-spectra/test/smoke/document-output.spec.ts`.
No product source was modified.

## Evidence contract

Every current research claim that affects prioritization records:

- observation date and geographic/product scope;
- primary source or reproducible dataset;
- metric definition and sampling method;
- whether the evidence is current, historical, inferred, or anecdotal;
- competing explanation and known selection bias;
- decision that the evidence supports;
- revalidation trigger.

Search snippets, copied marketing claims, unsourced review quotations, and point estimates without definitions are leads—not evidence.

## Lifecycle

- New evidence enters as `draft`.
- A decision memo may summarize validated evidence but links back to the source.
- Dynamic facts expire when their review window passes or the underlying product/policy changes.
- Historical evidence is archived rather than rewritten into current tense.
- An implementation owner never cites research alone as proof that behavior landed.
