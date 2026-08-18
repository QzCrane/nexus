---
type: reference
status: active
audience: contributor
owner: repository-governance
generated_from: ../architecture-closure.json
issue: 32
branch: codex/nexus-architecture-closure
---

# Architecture Closure Epoch

This file is generated from [`architecture-closure.json`](../architecture-closure.json). **Do not edit task state here.** The JSON manifest is the sole editable task authority; GitHub Issue #32 and this document are projections. Each task's full acceptance clauses, evidence paths, blocker, and counter-evidence live only in the JSON owner.

Priority is fixed at **P0 → P1 → P2**. Individual HALO feature internals remain P2 unless they block shared release correctness.

Current projection: 29 retained tasks; queued=16, active=12, blocked=1, done=0, rejected=0.

| Task | Priority | Area | Owner | Status | Acceptance clauses | Evidence items |
| --- | --- | --- | --- | --- | ---: | ---: |
| `SPECTRA-MEDIA-TAB-INVENTORY` | P0 | spectra | spectra-runtime | active | 5 | 4 |
| `HALO-RELEASE-ADMISSION` | P0 | halo-shared | halo-build | active | 3 | 5 |
| `HALO-EXPLICIT-RELEASE-STAGE` | P0 | halo-shared | halo-registry | active | 3 | 3 |
| `HALO-GENERATED-RESOURCE-SURFACES` | P0 | halo-shared | halo-build | active | 2 | 5 |
| `BACKLOG-SSOT` | P0 | repository | repository-governance | active | 2 | 2 |
| `ARCHITECTURE-CLOSURE-MANIFEST` | P0 | repository | repository-governance | active | 2 | 4 |
| `CONTINUOUS-GREEN-REPLAY` | P0 | ci | repository-ci | blocked | 2 | 3 |
| `MINIMUM-CHROME-EVIDENCE` | P0 | release | browser-compatibility | active | 2 | 6 |
| `RUNTIME-PERFORMANCE-SLOS` | P0 | performance | performance-governance | queued | 3 | 0 |
| `FEATURE-PROMOTION-GATE` | P0 | governance | release-governance | queued | 2 | 0 |
| `DEPENDENCY-DEAD-DIRECTS` | P1 | dependencies | dependency-governance | queued | 2 | 0 |
| `DEPENDENCY-LIFECYCLE-POLICY` | P1 | dependencies | dependency-governance | active | 2 | 2 |
| `DEPENDENCY-UPDATE-AUTOMATION` | P1 | dependencies | dependency-governance | active | 2 | 2 |
| `TYPESCRIPT-7-EPOCH` | P1 | toolchain | toolchain-governance | queued | 3 | 0 |
| `DIRECT-DEPENDENCY-REVALIDATION` | P1 | dependencies | dependency-governance | queued | 2 | 0 |
| `LOCK-DOMAIN-AUTHORITY` | P1 | toolchain | toolchain-governance | queued | 2 | 0 |
| `IMMUTABLE-ACTIONS` | P1 | supply-chain | supply-chain | active | 2 | 7 |
| `SBOM-LICENSE-PROVENANCE` | P1 | supply-chain | supply-chain | queued | 2 | 0 |
| `LEAST-PRIVILEGE-PROOF` | P1 | security | permission-governance | queued | 2 | 0 |
| `LOCAL-DIAGNOSTIC-BUNDLE` | P1 | observability | diagnostics | queued | 2 | 0 |
| `ACCESSIBILITY-GATE` | P1 | quality | ui-quality | queued | 3 | 1 |
| `VISUAL-REGRESSION-GATE` | P1 | quality | ui-quality | queued | 2 | 0 |
| `PROPERTY-MUTATION-TESTING` | P1 | quality | test-governance | queued | 2 | 0 |
| `RISK-WEIGHTED-TEST-OWNERSHIP` | P1 | quality | test-governance | queued | 2 | 0 |
| `HALO-GENERATED-CONTENT-ENTRY` | P1 | halo-shared | halo-runtime | active | 2 | 3 |
| `HALO-GENERATED-ACTIVE-SERVICES` | P1 | halo-shared | halo-runtime | active | 2 | 2 |
| `HALO-BACKGROUND-DEADLINES` | P1 | halo-shared | halo-runtime | queued | 2 | 0 |
| `HALO-PDF-CLOSURE` | P2 | halo-feature | halo-pdf | queued | 3 | 0 |
| `HALO-FEATURE-TAIL-AUDIT` | P2 | halo-feature | halo-product | queued | 2 | 0 |
