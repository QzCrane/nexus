---
type: reference
status: stable
audience: developer
owner: repository-release-closeout
last_reviewed: 2026-09-11
---

# Release closeout authority

This document owns the boundary between product proof, hosted replay, exact-head merge, and branch cleanup for the NEXUS repository. The executable authority is [`../closeout-policy.json`](../closeout-policy.json) plus [`../scripts/closeout-evidence.ts`](../scripts/closeout-evidence.ts). The policy remains at the workspace root so versioned authority cannot be confused with ignored, disposable `release/` evidence.

## Product host versus CI host

HALO and SPECTRA are Chrome MV3 extensions. Their product runtime is an installed Chromium/Chrome extension context, not an Ubuntu application. A local installed-Chromium run on Windows is valid product evidence for DOM, SidePanel, service-worker, offscreen, permission, navigation, and packaged-extension behavior.

Ubuntu or Windows runner parity is additionally required only when the changed mechanism itself crosses an operating-system boundary, such as filesystem paths, archive metadata, process spawning, shell behavior, native binaries, or toolchain resolution. Repeating the same Chrome behavior on Ubuntu does not make it more product-real.

GitHub-hosted jobs are an independent replay surface. `runner_id=0`, empty steps, and a billing/spending-limit annotation mean `INFRA_UNAVAILABLE`; they are neither product failure nor product success. The closeout policy deliberately does not make paid runner allocation the repository trust root.

## Policy identity

The production policy reader verifies the digest-pinned Bun image against the current `BUN_VERSION` exported by [`../scripts/toolchain-versions.ts`](../scripts/toolchain-versions.ts), not a second hard-coded version. That source is part of the receipt tool-hash closure. The current policy and stale/unpinned image counterexamples are tested through the same reader invoked by record and merge; passing receipt-shape fixtures alone does not validate the executable entrypoint. This changes no attempt, platform, artifact or promotion requirement.

## Exact-head evidence

Before recording evidence, the candidate is normalized to one squash-equivalent commit whose sole parent is the exact remote `main` base. After that candidate is pushed, first record the second-OS tooling lane from the exact committed tree. This lane extracts the repository-root `git archive HEAD` inside a digest-pinned Linux Bun image, performs a frozen install with Playwright/Puppeteer browser downloads explicitly disabled, and reruns the Git-independent platform-contract unit suite plus toolchain/governance/generator/archive tests without claiming that the extension product itself runs on Ubuntu. The index-aware `check-platform-contract.ts` owner runs on the Windows Git checkout before push; it is intentionally not invoked inside a source archive, which has neither `.git` nor an index. Browser installation and behavior remain owned by the Windows installed-Chromium release lanes. Platform and attempt records use exact-head-qualified filenames and exclusive creation. A valid existing exact slot is a semantic idempotent success; invalid or different content fails closed instead of overwriting history.

```powershell
bun scripts/closeout-evidence.ts platform-record
```

When the local Linux container host is unavailable, the existing Cross-platform
quality workflow can run this same command on its Docker-enabled Ubuntu host:
dispatch the candidate ref with `closeout-platform=true`, then download the
`closeout-platform-<head>` artifact into `nexus/artifacts/`. The workflow checks
out the exact dispatched commit and records the same digest-pinned image, source
archive and policy lanes. Other quality jobs are skipped for this explicit
receipt-only dispatch; ordinary PR quality remains unchanged. The verifier still
requires the receipt's head, tree, policy and tool digests to match locally.
No temporary execution branch, source-patch transport or alternative receipt
format is needed.

Product lanes may select an already-installed Chrome using
`NEXUS_CHROME_EXECUTABLE`; the closeout host identity fingerprints that same
executable for both drivers. Without an explicit path, each driver's normal
installed-browser resolution remains authoritative. A missing executable fails;
unused browser-cache contents never stand in for the browser actually exercised.

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

Before mutation, the tool refreshes hosted truth, retains its structured workflow, run-attempt, job, provider-app and executed-checkout observations, and requires the two promotion-boundary observations to agree. It then rechecks the Ready PR head and base. The full two-attempt receipts, Linux platform receipt and delivery observation are written under the exact candidate in the canonical `refs/notes/nexus-closeout` remote Git-notes ref. The PR comment is a readable projection of that same bundle. Both the note and comment are read back before promotion; a digest-only comment or an expiring CI artifact is not the durable receipt authority.

Each candidate can acquire exactly one closeout note. Publication starts from the exact remote notes tip, uses a temporary local notes ref, rejects different content already stored for that candidate, and pushes with an expected-old `--force-with-lease`. A concurrent note for another candidate causes a bounded rebuild on the new tip, preserving both notes; no path overwrites the existing candidate note. The remote note is fetched and compared byte-for-byte after the push. Its Git object is reachable through the dedicated remote ref while the candidate commit and source tree remain unchanged.

The note contains one as-of delivery snapshot rather than a second mutable state ledger. It records the actual remote main and candidate refs, PR head/base/state, exact candidate head/tree/base, both receipt attempts and digests, structured hosted run attempts, and the work still pending at that boundary. The initial result is `VERIFIED_PENDING_PROMOTION` because atomic promotion, provider projection readback and machine-local settlement have not yet happened. Recovery preserves that original timestamp and observation. Final output and the PR projection are derived from the immutable bundle plus fresh live readback; unavailable facts remain pending instead of being filled from an older run.

For a same-repository PR, one `git push --atomic` transaction fast-forwards `main` to the already squashed one-commit candidate and deletes the candidate ref. Explicit leases bind both `refs/heads/main:<verified-base>` and `refs/heads/<candidate>:<verified-head>`; movement of either ref rejects the whole transaction, so cleanup cannot partially succeed and `--match-head-commit` is not mistaken for a base lease. Cross-repository PRs are rejected because one remote transaction cannot lease both repositories. GitHub closes a PR whose exact head ref is deleted after that commit is promoted directly to `main`, but does not necessarily populate provider-owned `merged_at` or `merge_commit_sha` fields for a Git ref transaction. The tool therefore accepts either an exact provider-merged projection or a plain closed projection, then independently requires remote `main == verified head`, exact commit-tree equality, and candidate-ref absence before reporting success.

Merge is a recoverable state machine. A first run accepts only `main == verified base`; after an atomic promotion or a lost response, rerunning `merge --pr` also accepts `main == verified head`, restores the full receipt bundle from the exact remote note when local ignored files are unavailable, and revalidates the unchanged commit tree, receipts, tools, artifacts, platform snapshot, hosted truth, PR identity, durable note and comment. It then resumes projection readback and exact cleanup. Standalone `verify --head` remains pre-promotion strict. Bounded retries plus this readback state prevent a transport failure after an irreversible ref update from turning success into an unsafe duplicate. Local primary-checkout synchronization, local branch/worktree removal, and a final remote/local ref audit remain explicit follow-up operations because they are machine-local state.

Every branch must end in exactly one semantic state before deletion:

1. merged into the verified `main` tree;
2. superseded by a named later implementation;
3. evidence/integration-only and closed without merge;
4. experiment discarded with no unique retained product work.

Branch count is not product backlog. A ref already contained by `main`, a historical PR head, or a transport-only branch is cleanup work, not another merge candidate.

## Bounded dependency proposals

Routine Bun version proposals are disabled in both lock domains through
[Dependabot's native version-PR limit](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/customizing-dependabot-security-prs).
The bot changes manifests and locks but cannot supply the semantic review,
toolchain-owner changes and exact lock revalidation required for admission.
Splitting the same incomplete proposal into more groups would only multiply red
checks. Select necessary upgrades through the current revalidation owner before
creating a development candidate; never auto-refresh its hash as a substitute for
review. PRs #37 and #38 were unselected routine proposals, not product backlog.
The validated immutable Actions updates from #36 are retained, with future Actions
proposals limited to one group and one open version PR.

The existing two-domain advisory audit remains mandatory. A zero version-PR limit
does not disable GitHub's separate security-update facility, but it does not
enable that facility either. At this settlement, repository vulnerability alerts
and automated security fixes were disabled; no change to those repository settings
is implied. Obsolete Bun cooldown, grouping and ignore rules are removed so they
cannot silently suppress a future separately enabled security fix.

## Provider projection versus physical promotion

GitHub's [`merge_commit_sha` field](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request)
can retain a precomputed test-merge SHA when a directly promoted PR closes without
a provider merge. Only a non-null `merged_at` selects the provider-merged branch,
which must match the verified head; an empty timestamp is invalid. A null or
missing timestamp selects the plain closed projection even if the preview SHA
remains. PR head/base, remote main, complete commit tree and candidate-ref absence
remain independent mandatory readbacks. PR #35 exposed this distinction after its
atomic promotion succeeded; its original receipts and promoted tree stay immutable.

As observed through GitHub REST on 2026-09-11, `QzCrane/nexus` is private and the
authenticated viewer has repository `ADMIN` permission. The branch-protection and
repository-ruleset endpoints both return HTTP 403 with the provider's private-repository
plan restriction, so their effective enforcement remains externally unknown; an
unprotected branch field does not prove that organization rules are absent. Actions are
enabled with `allowed_actions=all` and provider SHA pinning enforcement disabled. The
default workflow token permission is `read`, and workflows cannot approve pull-request
reviews. Repository workflow files still own their stricter immutable action pins.
These observations neither prove that the current human credential is least-privileged
nor satisfy the unresolved provider-enforcement acceptance condition. They are dated
provider facts, not a fabricated approval or a reason to weaken release verification.

## Docker inspection compatibility

The image lock is still a repository/version plus an immutable registry digest.
The Docker identity owner reads the standard JSON array from `docker image
inspect`, requires exactly one Linux image with a valid local image ID, and
matches the exact `oven/bun` repository digest. It does not accept a substring,
an unrelated repository sharing the same text, malformed output, or a different
OS. Existing platform receipts are rechecked at this same identity boundary.

A real hosted replay on Docker 28.0.4 exposed that `join .RepoDigests` in a Go
template can reject the engine's `[]interface{}` value even after a successful
pull. Re-pulling cannot repair a formatter failure. The JSON reader avoids that
formatter dependency; bounded command deadlines and inspection stderr preserve
the actual failure instead of reporting every inspection error as a missing
image. The pinned image, two product attempts, exact commit/tree, artifact hashes,
and atomic promotion requirements are unchanged.


## Git-free immutable source verification

The locked Bun image verifies a `git archive` snapshot, not a repository clone;
neither Git nor `.git` is part of that environment. Toolchain reference discovery
therefore scans the source filesystem in archive mode, including hidden workflow
and skill owners, with the same current-file predicate used for a Git checkout.
Installed dependencies, build output and historical archives are not current
source authority. Symlinks are rejected rather than followed outside the source.
A real checkout still requires a successful Git index read: missing Git or an
index failure never silently becomes an archive-mode pass. The scanner and
reference checker are included in the receipt's tool hashes. This changes no
platform lane, pinned image or required release attempt.


## Platform-complete runtime checks

Package and TypeScript-config classification normalizes the logical filename
before filtering. Filesystem I/O still uses the original native path. The quality
workflow executes the governance, toolchain and dependency checks on Windows as
well as Linux, not only the product build matrix. Release commands invoke the
installed Bun whose exact version each release owner validates; they do not
resolve a second runtime through an online package-execution step.

The dated audit is retained in `_archive/audits/2026-09-06-7230b68.json`.
`../remediation-status.json` tracks implementation and evidence separately;
neither an audit finding nor a focused unit pass is a release receipt.

## Actual browser launch evidence

Formal browser lanes enable the shared `scripts/browser-driver.ts` evidence
writer with the exact head, tree, run, attempt and artifact directory supplied
by release orchestration. The driver records one immutable receipt for every
physical Chromium launch, including repeated launches from one owner. HALO
reads the runtime version and command line through CDP; SPECTRA reads
`browser.version()` and the spawned browser process. Effective arguments are
sanitized, temporary profile paths are omitted, and profile construction is
recorded as non-secret metadata.

Executable size and SHA-256 are informational launch observations only. They
are recorded only from an actual browser-returned command/process path; absent
or unreadable identity is typed `unknown`, and configured executable overrides
never authenticate what ran. `collectDefaultReleaseBrowserOwners()` resolves
the maintained default product scripts through the existing package-token
parser and pinned TypeScript Compiler API so the closeout consumer can compare
required browser owners with the produced receipts. A receipt proves launch
identity for its bound run; it does not by itself prove the test passed or that
the browser binary is trusted.
