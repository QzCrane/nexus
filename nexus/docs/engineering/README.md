---
type: explanation
status: stable
audience: contributor
owner: engineering-principles
last_reviewed: 2026-07-20
---

# NEXUS engineering principles

NEXUS engineering converges on six constraints: one authority per domain, explicit identity and ownership, acknowledged actual state, event-driven lifecycles, zero neutral work, and executable release gates.

This file indexes EPR-001..029. Complete definitions currently remain in [`../principles/`](../principles/) during the documentation-layout migration. The repository documentation map is [`../README.md`](../README.md). This index is not a second SPECTRA or HALO architecture owner.

## Authority hierarchy

1. [`../../../rules.md`](../../../rules.md) owns repository workflow, security, environment, dependency, test, and Git constraints.
2. Executable contracts, source, tests, and release gates own implemented truth.
3. SPECTRA control semantics start at [`../../apps/extension-spectra/docs/control/README.md`](../../apps/extension-spectra/docs/control/README.md).
4. SPECTRA wire, topology, remote security, and source admission are owned by dedicated documents and do not maintain a second capability matrix.
5. HALO architecture is owned by [`../../apps/extension-halo/docs/architecture.md`](../../apps/extension-halo/docs/architecture.md); its roadmap is separate.
6. Plans, research, README files, store listings, and archived reports describe proposals, projections, or evidence and cannot redefine runtime behavior.

A rule is written once in its owner and linked elsewhere. Historical reports retain their original baseline and test results instead of being rewritten into current-state claims.

## Principle groups

| Group | Owner | Scope |
| --- | --- | --- |
| EPR-001..009 | [`../principles/01-state-and-ownership.md`](../principles/01-state-and-ownership.md) | SSOT, desired/actual/ACK/snapshot/UI separation, identity, READY, unique writer, native-first planning, Capture admission, site routes |
| EPR-010..018 | [`../principles/02-operations-and-safety.md`](../principles/02-operations-and-safety.md) | irreversible operations, pure reads, transactions, selection, attribution, native lifecycle, hotkeys, UI contracts, visualizer leases |
| EPR-019..025 | [`../principles/03-runtime-and-quality.md`](../principles/03-runtime-and-quality.md) | restart/update recovery, structured errors, external boundaries, authenticated remote, privacy, performance, module direction |
| EPR-026..029 | [`../principles/04-process-and-quality.md`](../principles/04-process-and-quality.md) | browser-semantic tests, reversible delivery, truthful public copy, Git/AI gates |
| Regression map | [`../principles/05-problem-to-principle-map.md`](../principles/05-problem-to-principle-map.md) | historical failures mapped to durable acceptance criteria |

## Compact EPR index

- **EPR-001**: every domain has one authority; compatibility aliases are read-only migrations.
- **EPR-002**: desired, actual, ACK, authoritative snapshot, and optimistic UI are distinct states.
- **EPR-003**: ACKs bind document, media/source, generation, revision, and intent identity.
- **EPR-004**: READY is a completed capability barrier, not script liveness.
- **EPR-005**: one document has one writable runtime; resources follow token and lease ownership.
- **EPR-006**: each `{document, media, field}` has one writer.
- **EPR-007**: choose the least-invasive complete strategy per capability, not one mode per page.
- **EPR-008**: Capture is an explicit full-output DSP path, never a read or native-control fallback.
- **EPR-009**: one normalized site has one persisted route; cache selection is not activation.
- **EPR-010**: prove admission before irreversible binding or privileged execution.
- **EPR-011**: reads are pure; an observation commit is explicit and revisioned.
- **EPR-012**: control transactions serialize, while unrelated field failures remain isolated.
- **EPR-013**: selection, restore, and observation have separate semantics; active media and active video remain independent.
- **EPR-014**: attribute events before selection so extension writes cannot impersonate user actions.
- **EPR-015**: PiP and fullscreen use native APIs, actual activation, lifecycle events, and getter readback.
- **EPR-016**: runtime ensure, repeat cancellation, and feedback ownership are explicit hotkey lifecycles.
- **EPR-017**: UI text, icons, reset, restore, and boundary errors are contract-governed.
- **EPR-018**: visualizers consume an active processor; they never create one from a read.
- **EPR-019**: navigation, update, disposal, and service-worker restart invalidate stale identities and recover leases.
- **EPR-020**: errors retain code, phase, retryability, and causal identity.
- **EPR-021**: messages, URLs, origins, QR data, and privileged inputs are validated at the boundary.
- **EPR-022**: remote control is off by default and reveals state only after HMAC authentication.
- **EPR-023**: privacy copy matches physical network traffic and explicit opt-in behavior.
- **EPR-024**: performance work cannot substitute cached guesses for correctness; every optimization has a measurable boundary.
- **EPR-025**: modules remain cohesive and dependencies directional; file size is a signal, not an architecture substitute.
- **EPR-026**: tests cover ordering, lifecycle, browser activation, navigation, restart, and production artifacts.
- **EPR-027**: each change is a reversible contract + implementation + test + documentation closure.
- **EPR-028**: public claims never exceed verified browser and release-gate capability.
- **EPR-029**: local Git and AI hooks enforce one quality floor; actual CI status is checked rather than assumed.

## Change closure

Before changing code, identify authority, projection, transport, executor, adapter, storage owner, identity, revision, generation, lease, cancellation, and failure handler. After changing code, update the owner contract and tests, verify no second writer or stale ACK, and run the applicable unit, type, lint, build, browser, artifact, architecture, privacy, localization, and diff checks. Before release, reconcile permissions, privacy policy, store copy, remote-site behavior, and the actual production package.