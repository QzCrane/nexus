---
name: release-halo
description: 执行 HALO 发布准备与候选包审计：版本、registry/permission、生产构建、SidePanel/Playwright、隐私与商店材料、可选 public 同步。触发短语:"release halo", "halo 发布", "halo 上架"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14, git 2.30+, Chrome, and authorized store access
metadata:
  category: release
  app: halo
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Edit Grep Glob WebSearch
---

# Release HALO

## Trigger

Use for a HALO release candidate or publication decision. An ordinary production build is not a release.

## Process

### 1. Check release readiness before changing the version

Read [`nexus/apps/extension-halo/plan.md`](../../../nexus/apps/extension-halo/plan.md) and verify that the repository actually contains the required public surfaces:

- product README;
- privacy policy matching all network/storage behavior;
- localized store copy and assets;
- release/package instructions or reproducible script;
- permission-usage evidence;
- production tests and artifact inspection.

If these do not exist, stop at a release-readiness report or create them as an explicit release task. Do not upload an undocumented extension merely because `dist/` builds.

### 2. Establish the candidate

- Select the target commit and SemVer change from actual release content.
- Reconcile `apps/extension-halo/package.json` with the generated/submitted manifest version.
- Review changes since the previous release/tag and identify permission, storage, network, migration, and user-data effects.
- Revalidate current Chrome Web Store requirements from primary sources.

Do not maintain a static current version or dependency list in this skill; read manifests and lockfile.

### 3. Run repository and HALO gates

From `nexus/`:

```bash
bun run --cwd apps/extension-halo typecheck
bun run lint
bun run verify:v
bun run --cwd apps/extension-halo test:ui
bun run --cwd apps/extension-halo test:playwright
bun run --cwd apps/extension-halo build:prod
```

Also run registry generation/verification and any focused tool tests affected by the release. Confirm SidePanel launch, service-worker recovery, permissions, restricted pages, import/export, local persistence, i18n, and cleanup.

“Local first” does not require every optional capability to work offline. Test and disclose each network-backed feature separately; verify inactive features create no hidden network or recurring work.

### 4. Inspect the production output

Review `apps/extension-halo/dist/` for:

- correct manifest/version/permissions;
- complete required locales and assets;
- no source maps, tests, source files, private docs, secrets, or debug code;
- no undeclared remote code or network destination;
- no duplicate/unreferenced bundles;
- correct package root when loaded unpacked.

The repository currently has no dedicated `release:halo` packager. Until one is added, create a candidate ZIP reproducibly from the contents of `dist/`, not from its parent directory, and record its checksum. On PowerShell:

```powershell
Compress-Archive -Path .\apps\extension-halo\dist\* -DestinationPath .\halo-v<version>.zip -Force
Get-FileHash .\halo-v<version>.zip -Algorithm SHA256
```

Do not use a fixed “under 5 MB” rule as proof. Explain unexpected size changes from the artifact graph.

### 5. Reconcile public truth

- Permission declarations match the exact manifest and plugin registry.
- Privacy copy distinguishes local defaults from optional network capabilities.
- Store listings contain only implemented, tested features and limitations.
- Tool counts come from the generated registry at the release commit.
- Cross-browser claims are made only for browsers actually included in the release test matrix.

### 6. Publish and synchronize within authorization

- Upload or submit only with explicit authorization.
- Record the exact ZIP checksum and store submission status.
- Run `bun run sync-halo` only when public-repository synchronization is approved; inspect the generated diff before push.
- Commit, tag, push, public sync, and store submission remain separate authorized actions.

## Prohibited shortcuts

- Version bump before the candidate scope is known.
- Treating build success as release readiness.
- Claiming every tool works offline when a feature uses external services.
- Copying SPECTRA permissions or release assumptions into HALO.
- Publishing without privacy, store, locale, and permission reconciliation.
- Hand-copying public repository files around the sync script.

## Completion evidence

- release prerequisites exist or the result is explicitly labeled not ready;
- candidate commit/version and change scope are recorded;
- repository/HALO type, lint, architecture, UI, browser, and production-build checks pass;
- artifact contents and checksum are inspected;
- permissions, privacy, locales, store copy, and generated registry agree;
- each authorized publication/sync/Git action is reported separately.