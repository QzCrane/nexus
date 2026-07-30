---
type: reference
status: stable
audience: contributor
owner: spectra-store-copy
last_reviewed: 2026-07-20
---

# SPECTRA store-listing maintenance

The locale files in this directory are public projections of one verified product. They may translate tone and sentence structure, but they must preserve the same capability set, limitations, privacy disclosure, and units.

## Sources of truth

- capability semantics: [`../docs/control/README.md`](../docs/control/README.md)
- privacy and network behavior: [`../PRIVACY.md`](../PRIVACY.md)
- permission/data declarations: [`privacy-justifications.md`](privacy-justifications.md)
- release evidence: contracts, tests, production package, and current release-gate output

A roadmap, archived report, old store listing, or competitor claim is not proof that a feature exists.

## Claims that require executable proof

Do not publish any of these without a release gate that defines and proves the scope:

- “all websites,” “universal compatibility,” or named-site guarantees;
- “zero CPU,” “zero latency,” “no system resources,” or fixed performance multipliers;
- reliable control of protected, encrypted, or DRM media;
- bypass of browser activation, permission, CORS, frame, or platform restrictions;
- an implicit limiter, hearing protection, or medical/accessibility outcome;
- exact hotkey, site, tool, test, or feature counts copied from a historical document;
- screenshot success for any frame or page;
- “no data transmission” while optional remote networking exists.

## Canonical capability vocabulary

Public copy may describe:

- effective volume up to 800%;
- 10-band EQ and explicit bass, compressor, mono, pan, and delay controls;
- playback speed, play/pause, seek, loops, markers, and supported video controls;
- optional authenticated phone remote;
- local settings and local media processing by default;
- no advertising, analytics, telemetry, or developer-operated collection service.

Public copy must also state that individual operations depend on the page, media, browser support, user activation, and permissions.

## Locale update process

1. Change the English capability statement.
2. Reconcile it with current contracts and the production package.
3. Update every locale in the same change; do not leave a broader promise in one language.
4. Recheck summary-length limits and locale-specific store requirements.
5. Compare privacy wording with `PRIVACY.md` and the Dashboard declarations.
6. Review translations for meaning, not word-for-word similarity.

## Current locales

- `en-US.md`
- `zh-CN.md`
- `zh-TW.md`
- `de-DE.md`
- `es-ES.md`
- `fr-FR.md`
- `ja-JP.md`
- `ko-KR.md`
- `ru-RU.md`