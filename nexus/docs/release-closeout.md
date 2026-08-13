---
type: reference
status: stable
audience: developer
owner: repository-release-closeout
last_reviewed: 2026-08-13
---

# Release closeout authority

This document owns the boundary between product proof, hosted replay, exact-head merge, and branch cleanup for the NEXUS repository. The executable authority is [`../closeout-policy.json`](../closeout-policy.json) plus [`../scripts/closeout-evidence.ts`](../scripts/closeout-evidence.ts). The policy remains at the workspace root so versioned authority cannot be confused with ignored, disposable `release/` evidence.

## Product host versus CI host

HALO and SPECTRA are Chrome MV3 extensions. Their product runtime is an installed Chromium/Chrome extension context, not an Ubuntu application. A local installed-Chromium run on Windows is valid product evidence for DOM, SidePanel, service-worker, offscreen, permission, navigation, and packaged-extension behavior.

Ubuntu or Windows runner parity is additionally required only when the changed mechanism itself crosses an operating-system boundary, such as filesystem paths, archive metadata, process spawning, shell behavior, native binaries, or toolchain resolution. Repeating the same Chrome behavior on Ubuntu does not make it more product-real.

GitHub-hosted jobs are an independent replay surface. `runner_id=0`, empty steps, and a billing/spending-limit annotation mean `INFRA_UNAVAILABLE`; they are neither product failure nor product success. The closeout policy deliberately does not make paid runner allocation the repository trust root.

## Exact-head evidence

Before recording evidence, the candidate is normalized to one squash-equivalent commit whose sole parent is the exact remote `main` base. After that candidate is pushed, first record the second-OS tooling lane from the exact committed tree. This lane extracts the repository-root `git archive HEAD` inside a digest-pinned Linux Bun image, performs a frozen install with Playwright/Puppeteer browser downloads explicitly disabled, and reruns the Git-independent platform-contract unit suite plus toolchain/governance/generator/archive tests without claiming that the extension product itself runs on Ubuntu. The index-aware `check-platform-contract.ts` owner runs on the Windows Git checkout before push; it is intentionally not invoked inside a source archive, which has neither `.git` nor an index. Browser installation and behavior remain owned by the Windows installed-Chromium release lanes. Platform and attempt records use exact-head-qualified filenames and exclusive creation. A valid existing exact slot is a semantic idempotent success; invalid or different content fails closed instead of overwriting history.

```powershell
bun scripts/closeout-evidence.ts platform-record
```

Then, when the PR base is the current remote `main`, record two complete Windows installed-Chromium attempts:

```powershell
bun scripts/closeout-evidence.ts record --attempt 1 --base <40-char-main-sha>
bun scripts/closeout-evidence.ts record --attempt 2 --base <same-sha>
bun scripts/closeout-evidence.ts verify --head <40-char-candidate-sha>
```

Each attempt runs the maintained `release:halo` and `release:spectra` gates. The receipts bind:

- candidate commit, complete Git tree, and exact remote-main base;
- Bun, OS, Playwright Chromium, and Puppeteer Chrome identity;
- release-policy and release-tool hashes;
- HALO and SPECTRA versions;
- deterministic HALO and SPECTRA ZIP paths, sizes, and SHA-256 values;
- every local release lane result;
- hosted status as a separate exact-head fact read directly from GitHub. Runner-allocation billing failure is accepted only when failed jobs have `runner_id=0`, no steps, and the matching GitHub annotation; a real product/check failure blocks closeout.
- a digest-bound Linux container receipt for the platform-sensitive path/process/archive/governance mechanisms changed in this release.

Hosted evidence is fetched through one authenticated GitHub REST connection owner with bounded exponential retries for transport errors and retryable HTTP status codes. Authentication, authorization, malformed-path, and other non-retryable responses fail immediately. This prevents a slow TLS handshake from restarting an otherwise valid closeout while preserving fail-closed evidence semantics.

Both product release lanes call the single `audit:dependencies` owner. It parses Bun's JSON advisory response, fails immediately for any advisory, retries only certificate/connection/invalid-response failures at most six times with bounded exponential backoff, and fails closed if npm audit infrastructure remains unavailable. A transient transport error is never recorded as a clean dependency result.

Both attempts must have the same head, tree, base, product versions, tool identity, host identity, and artifact hashes. The verifier rejects a dirty tree, moved base, changed tool, changed artifact, missing lane, invalid digest, mismatched attempt, or a current exact-head Linux record that differs from the snapshot embedded in the receipts. Retrying an existing attempt revalidates all immutable local bindings and refreshes hosted truth; a later real hosted failure is therefore never hidden by an earlier `NOT_APPLICABLE` observation.

## Merge and cleanup

The PR must be open, Ready, target `main`, and still point to the verified head. Merge through:

```powershell
bun scripts/closeout-evidence.ts merge --pr <number>
```

Before mutation, the tool refreshes hosted truth, publishes both receipt digests, exact head/tree/base, artifact hashes, digest-pinned Linux identity, attempt-time hosted details, and the promotion-time hosted observation to the PR, then reads the exact comment back. It refreshes hosted truth again and requires the two boundary observations to agree, then rechecks the Ready PR head and base.

For a same-repository PR, one `git push --atomic` transaction fast-forwards `main` to the already squashed one-commit candidate and deletes the candidate ref. Explicit leases bind both `refs/heads/main:<verified-base>` and `refs/heads/<candidate>:<verified-head>`; movement of either ref rejects the whole transaction, so cleanup cannot partially succeed and `--match-head-commit` is not mistaken for a base lease. Cross-repository PRs are rejected because one remote transaction cannot lease both repositories. The tool then reads back the GitHub merged projection, remote `main`, commit tree, and candidate-ref absence through exact SHA guards.

Merge is a recoverable state machine. A first run accepts only `main == verified base`; after an atomic promotion or a lost response, rerunning `merge --pr` also accepts `main == verified head`, revalidates the unchanged commit tree, receipts, tools, artifacts, platform snapshot, hosted truth, PR identity, and durable comment, then resumes projection readback and exact cleanup. Standalone `verify --head` remains pre-promotion strict. Bounded retries plus this readback state prevent a transport failure after an irreversible ref update from turning success into an unsafe duplicate. Local primary-checkout synchronization, local branch/worktree removal, and a final remote/local ref audit remain explicit follow-up operations because they are machine-local state.

Every branch must end in exactly one semantic state before deletion:

1. merged into the verified `main` tree;
2. superseded by a named later implementation;
3. evidence/integration-only and closed without merge;
4. experiment discarded with no unique retained product work.

Branch count is not product backlog. A ref already contained by `main`, a historical PR head, or a transport-only branch is cleanup work, not another merge candidate.
