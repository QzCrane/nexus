---
type: explanation
status: stable
audience: contributor
last_reviewed: 2026-07-20
---

# 04. Process and quality gates (EPR-026..029)

> Owner: testing evidence, reversible delivery, truthful public copy, and Git/AI quality gates.
> Index: [engineering-principles.md](../engineering-principles.md)

## EPR-026: tests cover ordering and real browser semantics

Unit tests verify pure functions and bounded transforms. Contract tests verify protocol, storage, permission, and localization shapes. State-machine and integration tests cover navigation, media/source replacement, UI closure, shortcuts, processor handoff, disposal, restart, and update. Chrome tests cover browser-only semantics such as trusted activation, PiP/fullscreen lifecycle, MutationObserver behavior, service-worker suspension, offscreen ownership, and the production extension artifact.

Typecheck, lint, unit tests, build, browser tests, and artifact inspection prove different properties. No single green command proves architectural completion.

## EPR-027: each change forms a reversible closure

A coherent change includes the necessary contract, implementation, focused tests, owner documentation, migration, and public/release projection. Before editing, locate the authority, callers, runtime domain, identity, lifecycle owner, and failure handler. After editing, inspect the complete diff and run the smallest direct tests followed by every applicable repository and browser gate.

A commit should be independently understandable and reversible. Historical reports state their date, commit, evidence scope, and remaining risks; their measurements do not become present-tense facts.

## EPR-028: public copy never exceeds verified capability

Statements such as “all websites,” “zero CPU,” “any protected media,” “completely no data transmission,” guaranteed screenshots, or hearing-protection outcomes require a defined release gate that actually proves their scope. Browser permissions, user activation, origin/frame restrictions, CORS, protected content, closed component boundaries, and unsupported page APIs remain legitimate structured failures.

README, privacy policy, store copy, permission declarations, and remote-site disclosure must match the exact production artifact and physical network behavior.

## EPR-029: Git and AI hooks enforce one quality floor

The deployed local Git gate is [`../../../lefthook.yml`](../../../lefthook.yml). Root [`../../../package.json`](../../../package.json) installs Lefthook through `postinstall` and `prepare`.

- **pre-commit** runs the Markdown structure linter and Biome on the configured staged-file sets;
- **commit-msg** runs commitlint with the repository Conventional Commit configuration;
- **pre-push** runs the AI-hook smoke suite, `verify:q`, and `sync:skills`;
- **post-merge** runs `sync:skills`, which refreshes the generated Project Skills table in `AGENTS.md`;
- **post-analyze** is a separate workspace script that restores the `CLAUDE.md` → `AGENTS.md` hardlink after GitNexus regeneration.

The host-specific AI hooks documented in [`../../scripts/hooks/README.md`](../../scripts/hooks/README.md) provide earlier feedback where the host exposes the required interception point. They are not a security boundary and do not replace Git, tests, review, or CI.

The repository must not claim that CI is deployed merely because local scripts are CI-ready. A PR or release checks the actual GitHub workflow/check status. When CI workflows exist, they should invoke the same maintained lint, typecheck, verification, test, build, and release scripts rather than reimplementing their logic.

Active internal Markdown under the configured documentation roots uses the required Diátaxis frontmatter and passes `nexus/scripts/lint-docs.mjs`. That linter checks structure; link validity, dynamic facts, technical semantics, and public-claim truth still require review and executable evidence.

## Change checklist

### Before code changes

- identify authority, projection, transport, executor, adapter, storage owner, and tests;
- write down identity, revision/generation, lease, cancellation, and failure ownership;
- inspect callers and impact before modifying a shared symbol;
- locate the owner document and existing static/release gates;
- distinguish implementation, compatibility code, proposal, and historical evidence.

### After code changes

- close contracts, implementation, focused tests, owner documentation, and migrations;
- verify there is no second writer, unbound runtime, stale ACK, guessed actual state, or missing disposer;
- run applicable unit/contract, typecheck, lint, architecture, build, browser, production-artifact, privacy, and localization checks;
- inspect `git diff --check`, the complete changed-file list, generated output, and dependency/permission/network changes;
- report every omitted gate or unresolved failure instead of describing the change as complete.

### Before release

- verify the candidate commit and working tree are explicit;
- reconcile manifest permissions, privacy policy, store locales, remote-site bytes/CSP/MIME, and the production package;
- verify default/inactive pages do not allocate AudioContext, Capture, analyser, offscreen, polling, or recurring work unless the owner contract requires it;
- verify remote state and commands are driven by current authenticated ACK/snapshot identity;
- inspect the actual GitHub checks and release-script output rather than relying on a roadmap or old report.