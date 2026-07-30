---
name: release-halo
description: 执行 HALO 发布准备与候选包审计：文档与 Bun 1.3.14 门禁、版本、registry/permission、生产构建、SidePanel/Playwright、隐私与商店材料、可选 public 同步。触发短语:"release halo", "halo 发布", "halo 上架"。
license: Proprietary. See LICENSE.txt
compatibility: Requires Bun 1.3.14, git 2.30+, Chrome, and authorized store access
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

Read:

- [HALO documentation](../../../nexus/apps/extension-halo/docs/README.md);
- [architecture](../../../nexus/apps/extension-halo/docs/architecture.md);
- [roadmap](../../../nexus/apps/extension-halo/docs/roadmap.md);
- [product README](../../../nexus/apps/extension-halo/README.md).

Verify the repository contains the required release surfaces:

- privacy policy matching all network/storage behavior;
- localized store copy and assets;
- reproducible package instructions or script;
- permission-usage evidence;
- browser tests and production-artifact inspection.

If these do not exist, stop at a release-readiness report or create them as an explicit task. A successful `dist/` build is not publication readiness.

### 2. Establish the candidate

- Select target commit and SemVer change from actual release content.
- Reconcile `apps/extension-halo/package.json` with the generated/submitted manifest version.
- Review changes since the previous release/tag and identify permission, storage, network, migration, and user-data effects.
- Revalidate current Chrome Web Store requirements from primary sources.

Do not maintain a static current version, tool count, or dependency list in this skill.

### 3. Read the canonical owners and executable release plan

- [HALO documentation](../../../nexus/apps/extension-halo/docs/README.md)
- [architecture](../../../nexus/apps/extension-halo/docs/architecture.md)
- [roadmap](../../../nexus/apps/extension-halo/docs/roadmap.md)

From `nexus/`:

```bash
bun run release:halo:plan
```

The maintained release script owns exact Bun 1.3.14 execution, production build, artifact integrity, staging, ZIP creation, and output naming. If this skill differs, update the skill rather than creating a parallel process.

### 4. Run the maintained release gate

From the repository root:

```bash
bun --cwd nexus release:halo
```

This runs architecture verify, frozen dependency install, toolchain verify, Biome lint, workspace dependency build, TypeScript check, unit tests, production build, dependency audit, and deterministic staging ZIP as a single ordered gate. A failure stops the release; the staging directory is cleaned before every run.

Confirm SidePanel launch, service-worker recovery, permissions, restricted pages, import/export, local persistence, i18n, and cleanup separately. UI and Playwright tests are not yet part of the automated gate; run them explicitly when applicable.

"Local first" does not require every optional capability to work offline. Test and disclose each network-backed feature separately; inactive features create no hidden network or recurring work.

### 5. Inspect the production output

Review `apps/extension-halo/dist/` and `apps/extension-halo/release/.staging/` for:

- correct manifest, version, and permissions;
- complete required locales and assets;
- no source maps, tests, source files, private docs, secrets, or debug code;
- no undeclared remote code or network destination;
- no duplicate or unreachable bundles;
- correct package root when loaded unpacked;
- the staged ZIP matches the recorded SHA-256 and is byte-reproducible across two consecutive generations.

Do not use a fixed size threshold as proof; explain artifact-graph changes.

### 6. Reconcile public truth

- permission declarations match exact manifest and plugin registry;
- privacy copy distinguishes local defaults from optional network capabilities;
- store listings contain only implemented, tested features and limitations;
- tool counts come from the generated registry at the candidate commit;
- cross-browser claims cover only browsers in the release test matrix;
- public sync output remains pinned to `bun@1.3.14`.

### 7. Publish and synchronize within authorization

- Upload or submit only with explicit authorization.
- Record exact ZIP checksum and store submission status.
- Run `bun run sync-halo` only when public synchronization is approved; inspect generated diff and Bun 1.3.14 metadata before push.
- Commit, tag, push, public sync, and store submission are separate actions.

## Prohibited shortcuts

- Version bump before candidate scope is known.
- Treating build success as release readiness.
- Claiming every tool works offline when a feature uses external services.
- Copying SPECTRA permissions or release assumptions into HALO.
- Publishing without documentation, toolchain, privacy, store, locale, permission, and production checks.
- Hand-copying public files around the generator.

## Completion evidence

- release prerequisites exist or the result is explicitly labeled not ready;
- candidate commit/version and change scope are recorded;
- Bun 1.3.14, documentation, registry, permission, type, lint, architecture, UI, browser, and production-build checks pass;
- artifact contents and checksum are inspected;
- permissions, privacy, locales, store copy, and generated registry agree;
- each authorized publication, sync, and Git action is reported separately.