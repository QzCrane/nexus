---
type: explanation
status: draft
audience: developer
owner: halo-product-research
last_reviewed: 2026-07-20
---

# HALO feature-gap backlog

This is a candidate backlog, not a statement that every “existing” feature is complete or every competitor feature desirable. Verify current source, tests, registry metadata, permissions, lifecycle behavior, and user need before promoting an item into the roadmap.

## Evaluation rule

A gap is worth closing when it improves a defined user workflow more than it adds permission, package-size, maintenance, performance, privacy, and interface cost. “A competitor has it” is evidence of existence, not evidence of priority.

## JSON tools

Candidates:

- tree view with bounded rendering for large inputs;
- JSONPath query with a declared dialect and precise errors;
- conversion to CSV, YAML, or XML through explicit schemas and loss warnings;
- file/URL import through the correct permission boundary;
- structural diff and exact syntax-error location.

Before implementation, define maximum input size, cancellation, worker use, formatting preservation, and export semantics.

## Hashing and verification

Candidates:

- HMAC with explicit key handling and zero persistence by default;
- SHA-3 and CRC variants only for evidenced workflows;
- digest comparison and batch-file verification;
- streaming file input so large files are not duplicated in memory.

The UI distinguishes cryptographic hashes, checksums, password hashing, and message authentication. It must not imply MD5 or SHA-1 is secure for adversarial integrity.

## Base64 and data URLs

Candidates:

- image/media preview after MIME and size validation;
- Data URL parsing and component inspection;
- decoded-file download with a safe filename and explicit type.

Large inputs require streaming or bounded rejection. Preview must not execute active content.

## QR codes

Candidates:

- color and contrast validation;
- optional logo embedding with scan-reliability checks;
- SVG export;
- bounded batch generation;
- vCard and Wi-Fi templates with exact escaping.

Every generated or scanned URL is previewed before navigation. History retention is local, configurable, and clearable.

## Time and date tools

Candidates:

- IANA time-zone selection;
- duration and business-day calculations;
- explicit input/output formats;
- DST ambiguity and invalid-local-time handling.

Avoid a custom `strftime` dialect unless a compatibility requirement justifies it.

## URL tools

Candidates:

- query-string editor preserving repeated keys and ordering when requested;
- syntax, scheme, and hostname validation;
- controlled navigation with an HTTP(S) allowlist.

Encoding, parsing, normalization, and safety classification are separate operations and must not be merged into one “valid URL” result.

## Remaining candidates

- UUID: version-specific generation/validation, namespaces, batch limits, and format conversion;
- regular expressions: match groups, replacement preview, engine selection, timeout/cancellation, and explainability boundaries;
- color: multiple color spaces, WCAG contrast, palette/gradient generation, bounded history, and page-pick permission;
- passwords: unbiased generation, excluded-character rules, strength explanation, and zero persistence by default.

## Prioritization

### P0: correctness and recovery

- JSON error location and bounded tree rendering;
- hash/HMAC verification with safe key handling;
- QR URL preview and contrast validation;
- WCAG contrast calculation;
- shared large-input cancellation and worker boundaries.

### P1: workflow completion

- Base64/Data URL preview and download;
- password-generation semantics and strength explanation;
- regex replacement preview and engine disclosure;
- time-zone and DST-safe calculations.

### P2: breadth after architecture closure

- conversion formats, batch processing, advanced templates, and optional integrations.

## Promotion gate

Before an item moves into implementation, record its owner, input limits, permissions, storage, lifecycle, network behavior, error model, i18n surface, tests, and release-document impact. Completion requires executable evidence, not a checklist mark in this file.