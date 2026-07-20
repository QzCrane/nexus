---
name: release-spectra
description: 执行 SPECTRA 发布闭环：计划检查、版本与工作树审计、生产打包、Chrome/远程/隐私/商店文案核对、可选 public 同步。触发短语:"release spectra", "spectra 发布", "spectra 上架"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, git 2.30+, Chrome, and authorized store access
metadata:
  category: release
  app: spectra
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Edit Grep Glob WebSearch
---

# Release SPECTRA

## Trigger

Use only for an intended release or release-candidate build, not for an ordinary development build.

## Process

### 1. Establish the release candidate

- Confirm the target version and source commit.
- Review the complete diff since the previous release/tag.
- Ensure the working tree is understood; do not package accidental local changes.
- Reconcile `apps/extension-spectra/package.json`, manifest generation/output, release notes, and store version requirements.
- Check current Chrome Web Store policy and any time-sensitive provider/browser behavior from primary sources.

Do not copy a “current version” into this skill. Read the manifest/package and release plan.

### 2. Inspect the maintained release plan

From `nexus/`:

```bash
bun run release:spectra:plan
```

Read the listed phases, inputs, output paths, and checks. If the script and this skill differ, the script is the executable release authority and this skill must be updated.

### 3. Run prerequisite gates

At minimum, run the current applicable set:

```bash
bun run typecheck:spectra
bun run lint
bun run verify:v
bun run test:spectra
bun run check:spectra-remote-live
```

Also inspect required Chrome integration, production artifact, localization, permission, and remote-security results. A smoke test alone does not prove audio routing, activation, navigation, update recovery, or remote authentication.

### 4. Build the release artifact

```bash
bun run release:spectra
```

The maintained script owns the exact Bun version, production build, artifact integrity, staging, ZIP creation, and output naming. Do not create a second manual ZIP path unless diagnosing the release tool.

Inspect the ZIP contents rather than enforcing an undocumented fixed size. Reject source maps, tests, source files, debug assets, undeclared remote code, duplicate bundles, stale locales, or unreferenced artifacts.

### 5. Reconcile public truth

Compare the exact artifact with:

- [`nexus/apps/extension-spectra/README.md`](../../../nexus/apps/extension-spectra/README.md)
- [`nexus/apps/extension-spectra/PRIVACY.md`](../../../nexus/apps/extension-spectra/PRIVACY.md)
- store locale files and `privacy-justifications.md`
- manifest permissions and host permissions
- [`remote-site/`](../../../remote-site/) and its live byte/security-header gate
- control, protocol, topology, source-admission, and remote-security owner documents

Every locale must describe the same feature and limitation set. Do not publish universal compatibility, protected-content, zero-CPU, medical, or no-transmission claims beyond evidence.

### 6. Publish and synchronize within authorization

- Upload to the Chrome Developer Dashboard only with explicit release authorization.
- Record the submitted artifact checksum/version and the actual review status.
- Run `bun run sync-spectra` only when the public-repository scope is approved; inspect its generated diff before pushing.
- Commit, tag, push, public sync, and store submission are separate mutations. Do not infer permission for all of them from permission to build a candidate.

## Prohibited shortcuts

- Packaging from a dirty or unexplained tree.
- Skipping Chrome/remote tests because unit tests pass.
- Manually editing generated manifest/locale output.
- Reusing old store copy without comparing the artifact and privacy flow.
- Treating a ZIP size threshold as the release gate.
- Claiming store review duration or acceptance before the platform reports it.

## Completion evidence

- target commit/version and release diff are recorded;
- prerequisite gates pass at the same candidate commit;
- maintained release script produces the inspected ZIP and checksum;
- permissions, privacy, remote deployment, store declarations, and all locales match the artifact;
- authorized Git/public/store mutations are completed and reported separately;
- any omitted gate or unresolved risk is explicit, so the result is labeled candidate rather than released.