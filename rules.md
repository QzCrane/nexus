---
type: reference
status: stable
audience: contributor
last_reviewed: 2026-07-20
---

# NEXUS repository rules

This file owns repository-wide workflow, security, dependency, architecture, quality, documentation, toolchain, and Git constraints. Domain contracts may impose stricter rules, but a README, roadmap, proposal, research note, archived report, or store listing cannot relax this floor. When prose conflicts with executable contracts, source, tests, or a release gate, stop and reconcile the sources.

## 1. Working directory and toolchain

- Primary workspace is `nexus/`. Root scripts proxy into workspace; do not invent parallel command surfaces.
- **Bun 1.3.14** is the repository runtime and package manager. Root, workspace, release, public-sync, CI, skills, and documentation references must align to `bun@1.3.14`.
- Do not introduce npm, pnpm, Yarn, another Bun version, or another package-manager lockfile without an explicit repository-wide migration decision.
- `nexus/scripts/check-toolchain.ts` is the executable toolchain-drift gate. Global installs, README examples, or generated public packages are not independent authorities.
- Generated files update through their generator, not by manual edits that the build erases.

### Cross-platform contract

- Repository text is UTF-8-compatible LF in both Git index and checkout (`.gitattributes`, `.editorconfig`). Binary assets require explicit `-text` exceptions.
- Automation uses Bun or Node filesystem/path APIs and argument-array child processes. OS shell executables, `exec`/`execSync`, `shell: true`, and host-specific scripts are prohibited.
- Temporary files derive from `os.tmpdir()`. Recursive cleanup has bounded retries for transient Windows locks. Archive and deployment paths use `/` at external boundaries and `node:path` on disk.
- Tracked paths must be Unicode NFC, case-fold unique, legal on Windows, and free of symlinks. A script with a shebang is executable in the Git index; other files are not.
- [`nexus/scripts/check-platform-contract.ts`](nexus/scripts/check-platform-contract.ts) is the executable drift gate (runs locally before push, and in Windows + Ubuntu CI).

## 2. Change preparation

Before modifying behavior:
1. Identify domain authority and public contract.
2. Inspect callers, consumers, lifecycle owners, tests, and release gates.
3. Distinguish implemented behavior, compatibility code, historical evidence, and proposed work.
4. State identity, revision/generation, owner, disposer, and failure handler affected by the change.
5. Check whether a smaller owner-level fix eliminates multiple symptoms.

Do not preserve a known-wrong structure merely to minimize the diff. Do not replace a large file merely to avoid understanding it. Scope must be the smallest coherent change that restores correct ownership.

## 3. Single source of truth (SSOT)

- Each domain has one authoritative model.
- Projections, caches, UI state, adapters, generated indexes, and compatibility fields are not secondary authorities.
- Identifiers, status, permissions, routes, capabilities, lifecycles, toolchain versions, and doc owners must not be manually enumerated in competing sources.
- Legacy aliases are bounded migrations with an owner, exact target, and removal date or condition.
- Generated compatibility mirrors must be byte-identical to the canonical physical owner and verified by the documentation gate (`docs:check`), possessing no independent edit authority.
- Plans and checklists do not prove implementation.
- Historical reports keep original date, commit, and evidence; they do not overwrite current state.

## 4. Module and dependency direction

- Contracts describe data, protocol, and validation shape without application business logic.
- Shared packages expose public facades; applications do not deep-import another domain's internals.
- Dependency direction remains acyclic and explicit.
- A module owns one cohesive responsibility and a complete lifecycle.
- File size, directory depth, and import count are review signals, not mechanical rules; split only at real boundaries.
- Do not create wrapper layers that only rename calls or duplicate an existing contract.

## 5. State, identity, and lifecycle

- Mutable state has one owner and an explicit persistence boundary.
- Work surviving UI closure belongs to a Background/runtime owner, not a mounted component.
- Every document-, tab-, media-, session-, or source-scoped operation carries identity (`tabId`, `documentId`, `generation`, `revision`) to reject stale results.
- Subscriptions, observers, timers, animation frames, object URLs, WebAudio nodes, streams, ports, and network requests require a disposer or cancellation path.
- Start, active, stopping, error, recovery, and terminal states are observable where they affect user behavior.
- A read does not acquire mutation or processing resources unless the contract explicitly defines that side effect.

## 6. Errors and asynchronous work

- Do not use empty catch blocks or discard rejected promises.
- Catch values begin as `unknown` and are narrowed before use.
- Errors retain an actionable code, message, phase, retryability, and relevant identity.
- Retrying is bounded, cancellable, and justified by the failure class.
- Permission denial, user-activation failure, stale identity, invalid input, unsupported browser behavior, and protected-content boundaries are not converted into generic timeouts.
- Core I/O has an explicit timeout or cancellation model when the underlying API supports it.

## 7. Security and privacy

- Secrets, credentials, private keys, session tokens, personal data, and sensitive configuration do not enter Git.
- Validate messages, senders, URLs, origins, file paths, network responses, and untrusted bytes before execution or allocation.
- Privileged operations are allowlisted by capability and user action.
- Do not download or execute remote extension code.
- Do not broaden permissions to avoid designing an exact boundary.
- Public privacy claims match physical traffic, third-party providers, transmitted fields, retention, and opt-in behavior.
- Local-first and zero-telemetry claims do not imply zero network traffic when an optional network feature exists.
- User-authored scripts remain inside the declared sandbox and never inherit internal privileged adapters.

## 8. Dependencies

Before adding or upgrading a dependency:
1. Confirm official package, stable version, license, maintenance state, security advisories, browser/runtime compatibility, bundle contribution, and transitive dependencies.
2. Verify platform or existing code cannot provide capability with lower lifecycle and maintenance cost.
3. Pin or range versions according to repository policy and update lockfile with Bun 1.3.14.
4. Add only the dependency needed by the owning package.
5. Document any external ABI, network, worker, or asset implications.

A dependency is not justified only because it reduces initial implementation time.

## 9. Performance

- Correctness and ownership come before micro-optimization.
- Inactive features perform no recurring work unless a documented browser lifecycle requires it.
- Prefer browser events, subscriptions, and one-shot alarms over polling.
- Pause optional rendering, sampling, and expensive work when hidden or unowned.
- Bound concurrency, retries, queues, caches, input size, IPC rate, storage writes, and memory growth.
- Avoid repeated allocation, parsing, layout reads, serialization, and I/O in hot loops.
- Claims such as "zero CPU", "zero allocation", "10x faster", or fixed memory limits require a reproducible workload and production-build measurement.
- Performance optimization must not replace an actual read with a cached guess or remove required validation.

## 10. TypeScript

- `strict: true` is the baseline.
- Avoid `any`; `as any` is prohibited except inside a narrowly documented compatibility boundary that cannot be expressed safely otherwise and has a removal plan.
- Prefer derived types and discriminated unions to duplicated DTOs and unstructured string switches.
- Runtime validation remains necessary at extension, storage, network, and untrusted-data boundaries; compile-time types are not runtime proof.
- Type assertions require evidence that the checked runtime boundary establishes the asserted shape.
- Every promise is awaited, returned, deliberately detached through an owned helper, or handled.

## 11. Testing and verification

A change runs the smallest focused checks during development and the complete applicable gate before merge. The verification set includes:
- Pure logic: unit and property tests
- Contracts and runtime guards: contract tests
- State machines: lifecycle tests
- Toolchain: Bun 1.3.14 verification
- Docs: architecture, links, redirects, generated compatibility mirrors, and owner reachability
- Code: TypeScript, lint, formatting, and architecture checks (`verify`)
- Build: production build and artifact inspection
- Integration: Chrome integration and user-activation behavior
- Scenarios: navigation, service-worker restart, update, hidden-state, cancellation, and disposal cases
- Reconciliation: privacy, permissions, localization, remote-site, store-copy, and generated public repository

A green typecheck, unit suite, docs check, or workflow registration alone does not prove browser behavior or release readiness. A CI workflow that never starts a runner is infrastructure failure.

## 12. Documentation architecture

- Canonical map: [`nexus/docs/README.md`](nexus/docs/README.md).
- Organized by authority and lifecycle: engineering, product, research, application architecture, roadmap, proposal, public projection, and archive.
- Active internal documentation uses one Diátaxis type, lifecycle status, audience, and explicit owner.
- Put normative behavior in one owner; link to it elsewhere.
- Roadmaps sequence work, proposals describe unresolved designs, research records dated evidence, public documents project verified behavior, and archives preserve historical state. None substitutes for implementation.
- Document moves: create canonical destination, update indexes and executable consumers, supply bounded deprecated redirect or byte-identical mirror, and declare removal timing.
- Tables: use when reducing ambiguity in a matrix, mapping, comparison, or ledger (not merely for visual compression).
- Code examples are executable or clearly marked as pseudocode. Relative links remain valid after a move or rename.
- Research, plans, audits, and verification snapshots state date and evidence scope.
- Dynamic facts (versions, prices, policies, counts, APIs, market data) revalidated before current use.
- Public documentation does not promise more than production artifact and browser tests prove.
- Structural gate: `bun run docs:check` (weakening to hide a duplicate owner, orphan, invalid redirect, compatibility-mirror drift, or dead link is prohibited).

## 13. Git and review

- Use Conventional Commits (`feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`) with accurate scope and message.
- One commit forms a coherent and reversible closure. Do not mix unrelated cleanup into a behavioral fix.
- Review final diff for accidental generated output, secrets, debug code, stale links, toolchain drift, and deleted evidence.
- Do not force-push a shared or release branch by default. Do not merge with failing required checks or unresolved review findings.
- Every non-default branch reaches exactly one terminal disposition: merge, superseded close, evidence-only close, or experiment discard. Record that disposition on its pull request (or equivalent durable review record), then delete the remote ref after confirming the required semantic delta is either on the default branch or intentionally rejected.
- Keep provider branch state coupled to the pull-request lifecycle: enable automatic head deletion after merge, close superseded/integration-only candidates promptly, and verify live remote refs rather than treating local tracking refs as authority. A blocked candidate gate never authorizes bypassing the gate and never blocks cleanup of unrelated refs already contained by the default branch.
- Generated public-repository sync is inspected and validated as a release artifact before push.

## 14. Current external facts

- Use current primary sources when a decision depends on package versions, browser APIs, build-tool syntax, store policy, remote provider behavior, CVEs, deprecations, or migration guides. Search summaries, copied articles, and old repository notes are discovery aids, not final authority. Record target version, date, platform, and source.
- Root cause model: when the same failure survives two attempted fixes, return to the root model (upstream issues, actual runtime evidence, identity/lifecycle assumptions, and competing owners) instead of adding another workaround.

## 15. Absolute prohibitions

1. Committed secrets or sensitive production configuration.
2. Circular dependencies or unowned cross-layer mutation.
3. Silent exception swallowing or unhandled asynchronous work.
4. Unbounded concurrency, retry, polling, queue, cache, or allocation.
5. Duplicated authorities or direct writes around an owning repository/coordinator.
6. Remote code execution inside the extension.
7. Permission, activation, origin, protected-content, or sandbox bypass claims.
8. Public claims known to exceed the production artifact.
9. Modifying generated files instead of their source.
10. Introducing a Bun version other than 1.3.14 or an alternate package-manager lockfile without a repository migration.
11. Moving documentation without updating its authority graph and executable validation.
12. Changing behavior without corresponding verification and owner documentation.
