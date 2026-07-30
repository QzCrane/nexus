---
type: explanation
status: stable
audience: contributor
last_reviewed: 2026-07-29
---

# 04. Process and quality gates (EPR-026..029)

> Owner: testing evidence, reversible delivery, truthful public copy, and Git/AI quality gates.
> Index: [engineering/README.md](../engineering/README.md)

## EPR-026: Tests Cover Ordering and Browser Semantics
Unit tests verify pure functions; contract tests verify protocol/storage/permission/locale shapes; integration tests cover navigation/replacement/shortcuts/disposal/restart; Chrome tests cover trusted activation/PiP/fullscreen/SW suspension/offscreen. No single green command proves completion.

## EPR-027: Reversible Delivery Closure
A coherent change includes contract, implementation, focused tests, owner docs, migration, and release projections.
- Delivery flow: **implement → focused evidence → local gate batch → verify projections → push**.
- Push is not the first validation run. Fix root causes directly rather than repeatedly replaying full matrix gates.

## EPR-028: Public Copy Truthfulness
Claims like "all websites", "zero CPU", "zero transmission", or guaranteed screenshots require executable release gates. Browser permissions, activation, CORS, DRM, and unsupported APIs remain legitimate structured errors. Copy must match actual production artifact behavior.

## EPR-029: Quality Floor Enforcement
- **Lefthook Git Gates**: `pre-commit` (Markdown linter + Biome), `commit-msg` (commitlint), `pre-push` (full repo linter, platform contract, toolchain, docs, `verify:q`, typecheck, AI-pitfall, `sync:skills --check`), `post-merge` (`sync:skills`).
- Turbo workspaces expose real lint tasks targeting Biome strict runner. Zero errors/warnings/skips allowed.
- Documentation roots enforce Diátaxis frontmatter verified by `nexus/scripts/lint-docs.ts`.

## Change Checklist

### Before Code Changes
- Identify authority, projection, transport, executor, adapter, storage owner, and tests.
- Note identity, revision/generation, lease, cancellation, and failure ownership.
- Inspect callers before modifying shared symbols; locate owner docs and static gates.

### After Code Changes
- Close contracts, implementation, focused tests, owner docs, and migrations.
- Verify no second writer, unbound runtime, stale ACK, guessed actual state, or missing disposer.
- Run unit/contract, typecheck, lint, architecture, build, browser, privacy, and localization checks.
- Inspect `git diff --check`, changed files, generated output, and permission/network changes.
- Execute gates as a single stable-candidate batch before push.

### Before Release
- Verify candidate commit and working tree; reconcile manifest permissions, privacy policy, store locales, and remote CSP.
- Confirm default/inactive pages allocate zero AudioContext/Capture/analyser/offscreen/polling.
- Verify remote commands depend on current authenticated ACK/snapshot identity; inspect actual CI/release script output.
