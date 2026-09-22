---
type: reference
status: archived
audience: developer
owner: spectra-release-evidence
last_reviewed: 2026-08-29
---

# SPECTRA v1.4.2 production artifact evidence (2026-08-29)

Historical candidate evidence only. Current metric definitions belong to
[`architecture/runtime.md`](../../architecture/runtime.md); current limits and
measurements come from `scripts/check-production-artifacts.ts` and the receipt
bound to the exact candidate.

The integrated Windows analysis produced artifact SHA-256
`6504eedd91e19794b8c94694583c808ec5e15adf750f72e3b474596e8a44ecf3`,
`84/84` reachable files, zero byte-identical duplicates,
`outputAttribution: measured`, 618,332 JavaScript bytes, and 709,960 total
bytes. Every hard ceiling passed; the 85% figures were non-blocking planning
targets.

| Executable surface | Measured bytes | Hard ceiling | 85% target max | Snapshot result |
| --- | ---: | ---: | ---: | --- |
| Service-worker wake | 231,774 | 262,144 | 222,822 | deficit 8,952 |
| `document_start` | 19,704 | 24,576 | 20,889 | within by 1,185 |
| Content bootstrap static script | 12,496 | 14,336 | 12,185 | deficit 311 |
| Lean site-hotkey static script | 9,693 | 11,264 | 9,574 | deficit 119 |
| Offscreen Capture-only script | 20,127 | 28,672 | 24,371 | within by 4,244 |
| Offscreen Remote possible script | 50,505 | 73,728 | 62,668 | within by 12,163 |
| Popup static script | 106,668 | 147,456 | 125,337 | within target |
| Popup possible script | 133,790 | 155,648 | 132,300 | deficit 1,490 |
| Popup possible payload | 145,305 | informational | — | script plus payload |
| Content runtime possible script | 159,324 | 180,224 | 153,190 | deficit 6,134 |
| Video-effects possible script | 10,444 | 12,288 | 10,444 | at target |
| Options possible script | 34,146 | 40,960 | 34,816 | within by 670 |
| Options possible payload | 43,655 | informational | — | script plus payload |
| Total production JavaScript | 618,332 | 696,320 | 591,872 | deficit 26,460 |
| Total production artifact | 709,960 | 798,720 | 678,912 | deficit 31,048 |
