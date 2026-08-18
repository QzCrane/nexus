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

The canonical task owner is [`architecture-closure.json`](../architecture-closure.json). This is a generated **status/index projection** only. Do not edit task semantics, acceptance clauses, evidence, blockers, or state here.

Single execution branch: `codex/nexus-architecture-closure`. Priority is fixed at **P0 → P1 → P2**. Individual HALO feature internals remain P2 unless they block shared release correctness.

Current projection: 29 retained tasks; queued=7, active=21, blocked=1, done=0, rejected=0.

| Task | Priority | Area | Owner | Status | Acceptance clauses | Evidence items |
| --- | --- | --- | --- | --- | ---: | ---: |
| `SPECTRA-MEDIA-TAB-INVENTORY` | P0 | spectra | spectra-runtime | active | 5 | 3 |
| `HALO-RELEASE-ADMISSION` | P0 | halo-shared | halo-build | active | 3 | 5 |
| `HALO-EXPLICIT-RELEASE-STAGE` | P0 | halo-shared | halo-registry | active | 3 | 3 |
| `HALO-GENERATED-RESOURCE-SURFACES` | P0 | halo-shared | halo-build | active | 2 | 5 |
| `BACKLOG-SSOT` | P0 | repository | repository-governance | active | 2 | 3 |
| `ARCHITECTURE-CLOSURE-MANIFEST` | P0 | repository | repository-governance | active | 2 | 4 |
| `CONTINUOUS-GREEN-REPLAY` | P0 | ci | repository-ci | blocked | 2 | 3 |
| `MINIMUM-CHROME-EVIDENCE` | P0 | release | browser-compatibility | active | 2 | 5 |
| `RUNTIME-PERFORMANCE-SLOS` | P0 | performance | performance-governance | active | 3 | 4 |
| `FEATURE-PROMOTION-GATE` | P0 | governance | release-governance | active | 2 | 3 |
| `DEPENDENCY-DEAD-DIRECTS` | P1 | dependencies | dependency-governance | active | 2 | 2 |
| `DEPENDENCY-LIFECYCLE-POLICY` | P1 | dependencies | dependency-governance | active | 2 | 4 |
| `DEPENDENCY-UPDATE-AUTOMATION` | P1 | dependencies | dependency-governance | active | 2 | 2 |
| `TYPESCRIPT-7-EPOCH` | P1 | toolchain | toolchain-governance | queued | 3 | 0 |
| `DIRECT-DEPENDENCY-REVALIDATION` | P1 | dependencies | dependency-governance | queued | 2 | 0 |
| `LOCK-DOMAIN-AUTHORITY` | P1 | toolchain | toolchain-governance | active | 2 | 5 |
| `IMMUTABLE-ACTIONS` | P1 | supply-chain | supply-chain | active | 2 | 4 |
| `SBOM-LICENSE-PROVENANCE` | P1 | supply-chain | supply-chain | active | 2 | 5 |
| `LEAST-PRIVILEGE-PROOF` | P1 | security | permission-governance | active | 2 | 5 |
| `LOCAL-DIAGNOSTIC-BUNDLE` | P1 | observability | diagnostics | queued | 2 | 0 |
| `ACCESSIBILITY-GATE` | P1 | quality | ui-quality | active | 2 | 3 |
| `VISUAL-REGRESSION-GATE` | P1 | quality | ui-quality | queued | 2 | 0 |
| `PROPERTY-MUTATION-TESTING` | P1 | quality | test-governance | active | 2 | 2 |
| `RISK-WEIGHTED-TEST-OWNERSHIP` | P1 | quality | test-governance | active | 2 | 4 |
| `HALO-GENERATED-CONTENT-ENTRY` | P1 | halo-shared | halo-runtime | active | 2 | 4 |
| `HALO-GENERATED-ACTIVE-SERVICES` | P1 | halo-shared | halo-runtime | active | 2 | 4 |
| `HALO-BACKGROUND-DEADLINES` | P2 | halo-feature | halo-timers | queued | 2 | 0 |
| `HALO-PDF-CLOSURE` | P2 | halo-feature | halo-pdf | queued | 3 | 0 |
| `HALO-FEATURE-TAIL-AUDIT` | P2 | halo-feature | halo-product | queued | 2 | 0 |
