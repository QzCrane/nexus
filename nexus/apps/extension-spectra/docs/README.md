---
type: reference
status: stable
audience: developer
owner: spectra-documentation
last_reviewed: 2026-11-01
---

# SPECTRA documentation

SPECTRA documentation is organized by authority so control semantics, runtime topology, wire protocols, security, source admission, planning, public copy, and historical evidence cannot compete.

```text
docs/
├── README.md
├── control/
│   ├── README.md
│   └── 01..08 topic owners
├── architecture/
│   ├── runtime.md
│   ├── media-source-admission.md
│   └── unification-and-professionalism-audit.md
├── reference/
│   └── protocols.md
├── security/
│   └── remote-control.md
├── proposals/
│   ├── README.md
│   ├── unified-design-2026-10-28.md
│   ├── unified-control-runtime-v3.md
│   └── unified-control-runtime-v3-implementation.md
├── roadmap.md
├── _archive/2026-Q3/
```

## Normative owners

- [Control architecture](control/README.md): product semantics, per-capability strategy, state, media/video behavior, algorithms, implementation ownership, invariants, and release gates.
- [Runtime architecture](architecture/runtime.md): context topology, loading, storage, durable runtime snapshots, the Action Popup first frame (announced card count, pre-paint theme, per-shape height), leases, and runtime ownership.
- [Media-source admission](architecture/media-source-admission.md): one-shot Capture admission, sole processor ownership, ACK and disposal proof.
- [Runtime protocols](reference/protocols.md): cross-context envelopes, validation, state flow, READY, and leases.
- [Remote-control security](security/remote-control.md): pairing, authentication, session binding, expiry, and network disclosure.

## Non-normative layers

- [Roadmap](roadmap.md): sequencing and unresolved work.
- [Unification audit roadmap](architecture/unification-and-professionalism-audit.md): dated audit conclusions and remediation ordering; never implementation authority.
- [Proposals](proposals/README.md): candidate designs and their acceptance gates; proposals do not describe shipped behavior.
- [Historical evidence](_archive/2026-Q3/README.md): dated implementation, regression, and release snapshots.
- [Product README](../README.md), [privacy policy](../PRIVACY.md), and [store copy](../store-listings/README.md): public projections that must remain narrower than verified behavior.

`bun run docs:check` runs the documentation checker in strict mode.

## Authority rule

Executable contracts, source, tests, Chrome integration, production artifacts, and release gates remain implementation truth. A document is a runtime authority only for the scope explicitly assigned above. Historical-path mirrors and redirects cannot define or amend behavior.

## Release-gated totals

The control owner mirrors these executable totals:

- 51 contract capabilities;
- 28 persistent snapshot fields and 23 momentary operations;
- 50 audited source algorithms (`ALG-001..ALG-050`);
- 50 static invariants (`SCTRL-001..SCTRL-050`).

A total changes only with the corresponding contract, implementation catalog, tests, owner documentation, and verifier.
