---
type: reference
status: stable
audience: developer
owner: spectra-documentation
last_reviewed: 2026-11-09
---

# SPECTRA documentation

SPECTRA documentation is organized by authority so control semantics, runtime topology, wire protocols, security, source admission, planning, public copy, and historical evidence cannot compete.

```text
docs/
├── README.md
├── guide/
│   ├── README.md
│   ├── 00-web-primer.md
│   ├── 01-extension-primer.md
│   ├── 02-spectra-map.md
│   └── glossary.md
├── control/
│   ├── README.md
│   └── 01..09 topic owners
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
- [Failure index](control/09-failure-index.md): reported symptom → the judgement that was wrong → the rule that governs it. Start here when a user reports behavior, not when reading the architecture.
- [State machines and business diagrams](control/README.md#diagram-and-business-flow-index): field/proof transitions, speed decisions, SPA media lifecycle, live-player closure and executable coverage, each linked to its existing topic owner.
- [Runtime architecture](architecture/runtime.md): context topology, loading, storage, durable runtime snapshots, the Action Popup first frame (all announced slots, pre-paint theme, intrinsic geometry), leases, and runtime ownership.
- [Media-source admission](architecture/media-source-admission.md): one-shot Capture admission, sole processor ownership, ACK and disposal proof.
- [Runtime protocols](reference/protocols.md): cross-context envelopes, validation, state flow, READY, and leases.
- [Remote-control security](security/remote-control.md): pairing, authentication, session binding, expiry, and network disclosure.

## Non-normative layers

- [Guide](guide/README.md): zero-prerequisite tutorial for readers who do not know front-end or browser-extension fundamentals. It explains and points at owners; it defines no behavior and carries no rule authority. Also [glossary](guide/glossary.md).
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
- `SCTRL-001..SCTRL-083` invariants; the range is parsed from the owner by the verifier, and every entry from 025 on must cite a symbol that ships.

A total changes only with the corresponding contract, implementation catalog, tests, owner documentation, and verifier.
