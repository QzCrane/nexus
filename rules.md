---
type: reference
status: stable
audience: contributor
last_reviewed: 2026-07-20
---

# NEXUS repository rules

This file owns repository-wide workflow, security, dependency, architecture, quality, and Git constraints. Domain contracts may impose stricter rules, but a README, roadmap, research note, archived report, or store listing cannot relax this floor.

When prose conflicts with executable contracts, source, tests, or a release gate, stop and reconcile the sources. Do not silently choose the convenient interpretation.

## 1. Working directory and toolchain

- The primary workspace is `nexus/`.
- Repository-root scripts proxy into the workspace; do not invent another working directory.
- Bun is the package manager and runtime for repository scripts.
- Do not introduce `npm`, `pnpm`, Yarn lockfiles, or package-manager-specific commands without an explicit migration decision.
- Use the versions and commands declared by the repository. A global tool installation is not an authority.
- Generated files are updated through their generator, not by manual edits that the next build will erase.

## 2. Change preparation

Before modifying behavior:

1. identify the domain authority and public contract;
2. inspect callers, consumers, lifecycle owners, tests, and release gates;
3. distinguish implemented behavior, compatibility code, historical evidence, and proposed work;
4. state the identity, revision/generation, owner, disposer, and failure handler affected by the change;
5. check whether a smaller owner-level fix eliminates multiple symptoms.

Do not preserve a known-wrong structure merely to minimize the diff. Do not replace a large file merely to avoid understanding it. The required scope is the smallest coherent change that restores one correct ownership model.

## 3. Single source of truth

- Each domain has one authoritative model.
- Projections, caches, UI state, adapters, generated indexes, and compatibility fields do not become second authorities.
- The same identifier, status, permission, route, capability, or lifecycle must not be manually enumerated in multiple modules.
- Legacy aliases are bounded migrations with an owner and removal condition.
- Plans and checklists do not prove implementation.
- Historical reports keep their original date, commit, and evidence; they do not overwrite current state.

## 4. Module and dependency direction

- Contracts describe data, protocol, and validation shape without application business logic.
- Shared packages expose public facades; applications do not deep-import another domain's internals.
- Dependency direction remains acyclic and explicit.
- A module owns one cohesive responsibility and a complete lifecycle.
- File size, directory depth, and import count are review signals, not mechanical architecture rules. Split only at a real boundary.
- Do not create wrapper layers that only rename calls or duplicate an existing contract.

## 5. State, identity, and lifecycle

- Mutable state has one owner and an explicit persistence boundary.
- Work that survives UI closure belongs to a background/runtime owner, not a mounted component.
- Every document-, tab-, media-, session-, or source-scoped operation carries enough identity to reject stale results.
- Subscriptions, observers, timers, animation frames, object URLs, audio nodes, streams, ports, and network requests require a disposer or cancellation path.
- Start, active, stopping, error, recovery, and terminal states must be observable where they affect user behavior.
- A read does not acquire mutation or processing resources unless the contract explicitly defines that side effect.

## 6. Errors and asynchronous work

- Do not use empty `catch` blocks or discard rejected promises.
- Catch values begin as `unknown` and are narrowed before use.
- Errors retain an actionable code, message, phase, retryability, and relevant identity.
- Retrying is bounded, cancellable, and justified by the failure class.
- Permission denial, user-activation failure, stale identity, invalid input, unsupported browser behavior, and protected-content boundaries are not converted into generic timeouts.
- Core I/O has an explicit timeout or cancellation model when the underlying API supports it.

## 7. Security and privacy

- Secrets, credentials, private keys, session tokens, personal data, and environment-specific sensitive configuration do not enter Git.
- Validate messages, senders, URLs, origins, file paths, network responses, and untrusted bytes before execution or allocation.
- Privileged operations are allowlisted by capability and user action.
- Do not download or execute remote extension code.
- Do not broaden permissions to avoid designing an exact boundary.
- Public privacy claims match physical traffic, third-party providers, transmitted fields, retention, and opt-in behavior.
- Local-first and zero-telemetry claims do not imply zero network traffic when an optional network feature exists.
- User-authored scripts remain inside the declared sandbox and never inherit internal privileged adapters.

## 8. Dependencies

Before adding or upgrading a dependency:

- confirm the current official package, stable version, license, maintenance state, security advisories, browser/runtime compatibility, bundle contribution, and transitive dependencies;
- verify that the platform or existing code cannot provide the capability with lower lifecycle and maintenance cost;
- pin or range versions according to repository policy and update the lockfile with Bun;
- add only the dependency needed by the owning package;
- document any external ABI, network, worker, or asset implications.

A dependency is not justified only because it reduces initial implementation time.

## 9. Performance

- Correctness and ownership come before micro-optimization.
- Inactive features perform no recurring work unless a documented browser lifecycle requires it.
- Prefer browser events, subscriptions, and one-shot alarms over polling.
- Pause optional rendering, sampling, and expensive work when hidden or unowned.
- Bound concurrency, retries, queues, caches, input size, IPC rate, storage writes, and memory growth.
- Avoid repeated allocation, parsing, layout reads, serialization, and I/O in hot loops.
- Claims such as “zero CPU,” “zero allocation,” “10× faster,” or fixed memory limits require a reproducible workload and production-build measurement.
- Performance optimization must not replace an actual read with a cached guess or remove required validation.

## 10. TypeScript

- `strict: true` is the baseline.
- Avoid `any`; `as any` is prohibited except inside a narrowly documented compatibility boundary that cannot be expressed safely otherwise and has a removal plan.
- Prefer derived types and discriminated unions to duplicated DTOs and unstructured string switches.
- Runtime validation remains necessary at extension, storage, network, and untrusted-data boundaries; compile-time types are not runtime proof.
- Type assertions require evidence that the checked runtime boundary establishes the asserted shape.
- Every promise is awaited, returned, deliberately detached through an owned helper, or handled.

## 11. Testing and verification

A change runs the smallest focused checks during development and the complete applicable gate before merge.

The verification set may include:

- unit and property tests for pure logic;
- contract and runtime-guard tests;
- state-machine and lifecycle tests;
- TypeScript, lint, formatting, and architecture checks;
- production build and artifact inspection;
- Chrome integration and user-activation behavior;
- navigation, service-worker restart, update, hidden-state, cancellation, and disposal cases;
- privacy, permissions, localization, remote-site, and store-copy reconciliation.

A green typecheck or unit suite alone does not prove browser behavior or release readiness.

## 12. Documentation

- Active internal documentation uses one Diátaxis type and a lifecycle status.
- The canonical documentation map is [`nexus/docs/documentation-index.md`](nexus/docs/documentation-index.md).
- Put normative behavior in one owner; link to it elsewhere.
- Use tables when they reduce ambiguity in a matrix, mapping, comparison, or ledger. Do not use tables merely for visual compression.
- Code examples are executable or clearly marked as pseudocode.
- Relative links are interfaces and must remain valid after a move or rename.
- Research, plans, audits, and verification snapshots state their date and evidence scope.
- Dynamic facts such as versions, prices, policies, counts, APIs, and market data are revalidated before current use.
- Public documentation does not promise more than the current production artifact and browser tests prove.

## 13. Git and review

- Use Conventional Commits: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, or `chore` with an accurate scope and message.
- One commit should form a coherent and reversible closure.
- Do not mix unrelated cleanup into a behavioral fix.
- Review the final diff for accidental generated output, secrets, debug code, stale links, and deleted evidence.
- Do not force-push a shared or release branch by default.
- Do not merge with failing required checks or unresolved review findings.
- A generated public-repository sync is inspected and validated as a release artifact before push.

## 14. Current external facts

Use current primary sources when a decision depends on package versions, browser APIs, build-tool syntax, store policy, remote provider behavior, CVEs, deprecations, or migration guides.

Search summaries, copied articles, and old repository notes are discovery aids, not final authority. Record the version, date, platform, and source that the implementation actually targets.

When the same failure survives two attempted fixes, return to the root model: inspect upstream issues, actual runtime evidence, identity/lifecycle assumptions, and competing owners instead of adding another workaround.

## 15. Absolute prohibitions

- committed secrets or sensitive production configuration;
- circular dependencies or unowned cross-layer mutation;
- silent exception swallowing or unhandled asynchronous work;
- unbounded concurrency, retry, polling, queue, cache, or allocation;
- duplicated authorities or direct writes around an owning repository/coordinator;
- remote code execution inside the extension;
- permission, activation, origin, protected-content, or sandbox bypass claims;
- public claims known to exceed the production artifact;
- modifying generated files instead of their source;
- changing behavior without corresponding verification and owner documentation.