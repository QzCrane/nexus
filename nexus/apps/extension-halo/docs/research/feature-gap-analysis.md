---
type: explanation
status: draft
audience: developer
owner: halo-product-research
last_reviewed: 2026-07-20
---

# HALO feature-gap backlog

Evaluation rule: A gap is worth closing only when it improves user workflow more than its permission, bundle-size, performance, or privacy cost.

## Tool Candidate Backlog

| Area | Key Candidate Capabilities | Boundary & Constraints |
| --- | --- | --- |
| **JSON** | Tree view, JSONPath query, CSV/YAML/XML export, structural diff | Define max input size, cancellation, and worker usage |
| **Hashing** | HMAC, SHA-3, CRC variants, streaming file input | Distinguish crypto hashes from checksums; zero default persistence |
| **Base64** | MIME size validation, Data URL inspection, safe file download | Bounded rejection for large inputs; active content execution forbidden |
| **QR Codes** | Contrast validation, logo embedding, SVG export, vCard/Wi-Fi templates | URL preview before navigation; local clearable history |
| **Time/Date** | IANA time-zones, duration calculations, DST handling | Avoid custom `strftime` dialects without explicit compatibility needs |
| **URL** | Query-string editor, scheme/hostname validation, allowlisted navigation | Separate encoding, parsing, normalization, and safety classification |
| **Utilities** | UUID v1-v5, Regex explain/preview, Color WCAG contrast, Password generator | Range limits, zero persistence for secrets, accessible UI |

## Prioritization & Promotion Gate

- **P0**: JSON error location & tree; Hash/HMAC verification; QR preview & contrast; WCAG contrast; large-input cancellation.
- **P1**: Base64 preview; Password strength; Regex replace preview; Time-zone DST calculations.
- **P2**: Additional conversion formats & batch processing.
- **Promotion Gate**: Requires explicitly defined owner, permissions, limits, storage, lifecycle, error model, i18n, and tests.
