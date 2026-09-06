---
type: reference
status: stable
audience: contributor
owner: repository-governance
last_reviewed: 2026-09-07
---

# NEXUS repository rules

This file contains invariants and authority routing only. Commands, versions,
schemas, and procedures belong to live manifests, scripts, contracts, and domain
owner documents.

## Core invariants

- Work in `nexus/` unless the task names another owned path. Preserve dirty,
  unrelated, protected, and user-owned work.
- One behavior has one canonical owner. Do not introduce mirrors, copied schemas,
  shims, aliases, parallel workflows, or hand-edited generated output.
- Diagnose to the root cause and make the smallest coherent change within the
  authorized scope. Audit is read-only; commit, push, publish, external writes,
  and destructive cleanup require their own authorization.
- Before changing shared behavior, inspect its owner, consumers, identity,
  lifecycle, failure paths, contracts, tests, and release projection.
- Fence stale asynchronous work; dispose resources; bound queues, retries, caches,
  concurrency, fan-out, and recovery state; surface failures explicitly.
- Validate untrusted boundaries with the canonical contract. Keep permissions and
  capabilities minimal, never execute remotely supplied extension code, and keep
  privacy claims aligned with the shipped artifact.
- Before implementing or repairing a generic capability, compare native APIs,
  existing dependencies, and maintained libraries before choosing custom code.
  Retaining a custom parser, codec, algorithm, validator, or infrastructure engine
  requires a concrete semantic, host, license, security, or measured-cost reason;
  fewer dependencies and sunk effort are not sufficient reasons. Use the
  [reuse decision owner](nexus/docs/decisions/library-reuse.md). An urgent minimal
  safety repair may precede replacement, but preserve its regression vectors and
  record the temporary implementation's exit condition.
- Dependencies require a real consumer and one current resolved version unless a
  proven constraint prevents it. Remove unused dependencies and stale physical
  copies. Measure performance on the production path.
- A test must protect a named invariant, boundary, failure mode, regression, or
  safety property. Remove proven duplicate or obsolete mirrors; type and unit
  evidence do not replace real-browser evidence.

## Authority and delivery

- Use the repository's current executable owners for toolchain, build, test,
  verification, release, and public projection. Roadmaps, proposals, reports,
  archives, and tests are not implementation authority.
- Preserve archives as historical evidence while excluding them from current
  drift authority. Change projections through their source owner.
- Validate the affected mechanism, then applicable integration and release
  boundaries on the frozen tree. Reconcile required documentation and public
  projections, and report exact evidence and blockers.
- Stop on duplicated authority, weakened guards, unbounded lifecycle, stale
  generated output, unexplained diffs, broken required gates, secret exposure, or
  any destructive target not resolved to an exact safe path.
