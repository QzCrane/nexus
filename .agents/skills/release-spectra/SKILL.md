---
name: release-spectra
description: 执行 SPECTRA 发布闭环：文档与 Bun 1.3.14 门禁、版本与工作树审计、生产打包、Chrome/远程/隐私/商店文案核对、可选 public 同步。触发短语:"release spectra", "spectra 发布", "spectra 上架"。
license: Proprietary. See LICENSE.txt
compatibility: Requires Bun 1.3.14, git 2.30+, Chrome, and authorized store access
metadata:
  category: release
  app: spectra
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Edit Grep Glob WebSearch
---

# Release SPECTRA

## Trigger

Use only for an intended release or release-candidate build, not an ordinary development build.

## Process

### 1. Establish the release candidate

- Confirm target version and source commit.
- Review the complete diff since the previous release or tag.
- Ensure the working tree is understood; do not package accidental local changes.
- Reconcile `apps/extension-spectra/package.json`, generated/submitted manifest version, release notes, and store requirements.
- Revalidate current Chrome Web Store policy and time-sensitive browser/provider behavior from primary sources.

Do not copy a static “current version” into this skill. Read the candidate manifests and release plan.

### 2. Read the canonical owners and executable release plan

- [SPECTRA documentation](../../../nexus/apps/extension-spectra/docs/README.md)
- [Control architecture](../../../nexus/apps/extension-spectra/docs/control/README.md)
- [Runtime architecture](../../../nexus/apps/extension-spectra/docs/architecture/runtime.md)
- [Protocols](../../../nexus/apps/extension-spectra/docs/reference/protocols.md)
- [Remote security](../../../nexus/apps/extension-spectra/docs/security/remote-control.md)

From `nexus/`:

```bash
bun run release:spectra:plan
```

The maintained release script owns exact Bun 1.3.14 execution, production build, artifact integrity, staging, ZIP creation, and output naming. If this skill differs, update the skill rather than creating a parallel process.

### 3. Run prerequisite gates

From the repository root:

```bash
bun run docs:check
bun --cwd nexus run check:toolchain
bun --cwd nexus run typecheck:spectra
bun run lint
bun --cwd nexus run verify:v
bun --cwd nexus run test:spectra
bun --cwd nexus run check:spectra-remote-live
```

Also inspect required Chrome integration, production-artifact, localization, permission, and remote-security results. A smoke test alone does not prove routing, activation, navigation, update recovery, or authentication.

### 4. Build and inspect the release artifact

```bash
bun --cwd nexus run release:spectra
```

Inspect the ZIP instead of enforcing an undocumented fixed size. Reject source maps, tests, source files, private docs, debug assets, undeclared remote code, duplicate bundles, stale locales, or unreachable artifacts. Record the exact checksum and candidate commit.

### 5. Reconcile public truth

Compare the artifact with:

- [`README.md`](../../../nexus/apps/extension-spectra/README.md);
- [`PRIVACY.md`](../../../nexus/apps/extension-spectra/PRIVACY.md);
- all store locales and `privacy-justifications.md`;
- manifest and host permissions;
- [`remote-site/`](../../../remote-site/) plus its live byte/header gate;
- canonical control, runtime, protocol, admission, and remote-security owners.

Every locale describes the same verified feature and limitation set. Do not publish universal compatibility, protected-content, zero-CPU, medical, or no-transmission claims beyond evidence.

### 6. Publish and synchronize within authorization

- Upload only with explicit store authorization.
- Record submitted checksum, version, and actual review status.
- Run `bun run sync-spectra` only when public-repository synchronization is separately approved; inspect its generated Bun 1.3.14 repository and diff before push.
- Commit, tag, push, public sync, and store submission are separate mutations.

## Prohibited shortcuts

- Packaging from a dirty or unexplained tree.
- Skipping documentation/toolchain/Chrome/remote gates because unit tests pass.
- Manually editing generated manifest, locale, or public-sync output.
- Reusing old store copy without comparing artifact and privacy flow.
- Treating a ZIP size threshold as the release gate.
- Claiming store acceptance or review duration before the platform reports it.

## Completion evidence

- candidate commit/version and release diff are recorded;
- Bun 1.3.14, documentation, type, lint, architecture, test, browser, remote, and artifact gates pass at that commit;
- maintained release script produces the inspected ZIP and checksum;
- permissions, privacy, remote deployment, store declarations, and locales match the artifact;
- authorized Git/public/store mutations are completed and reported separately;
- omitted gates or unresolved risks are explicit, so an incomplete result remains a candidate.