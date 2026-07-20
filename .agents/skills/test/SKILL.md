---
name: test
description: 按变更机制选择 NEXUS 聚焦测试、SPECTRA Chrome 测试或 HALO UI/Playwright 测试，并补足生命周期与生产构建证据。触发短语:"test", "run tests", "跑测试", "e2e"。
license: Proprietary. See LICENSE.txt
compatibility: Requires bun 1.3.14 and the browsers required by the selected suite
metadata:
  category: develop
  app: all
  phase: execute
  user-invocable: true
allowed-tools: Bash Read Grep
---

# Run tests

## Trigger

Use after behavior changes, when reproducing a regression, or before merge/release.

## Select by mechanism

Choose tests from the behavior's real boundary:

- pure contracts/algorithms: focused unit tests;
- storage, revision, identity, and lifecycle: state-machine/integration tests;
- Content, activation, navigation, media, offscreen, remote, or extension packaging: Chrome tests;
- HALO SidePanel interaction and layout: UI review and Playwright tests;
- production-only bundling/property behavior: production build and artifact checks.

Do not run only the nearest file when the failure crosses contexts. Do not run every browser suite blindly for an isolated pure function.

## SPECTRA

From `nexus/`:

```bash
# Maintained complete SPECTRA test script
bun run test:spectra

# Focused app scripts when iterating
bun run --cwd apps/extension-spectra test:unit
bun run --cwd apps/extension-spectra test:chrome
bun run --cwd apps/extension-spectra test:smoke
```

`test:e2e` currently aliases the Chrome suite. Read the package manifest instead of assuming a separate end-to-end implementation.

Changes to audio routing, user activation, Content runtime, navigation, offscreen, remote authentication, production property mangling, or release packaging need the corresponding specialized gates in addition to the generic test command.

## HALO

```bash
bun run --cwd apps/extension-halo test:ui
bun run --cwd apps/extension-halo test:playwright
```

Add focused unit tests for plugin core logic, registry generation, permissions, storage recovery, background lifecycle, and data conversion rather than forcing all correctness through UI snapshots.

## Regression workflow

1. Reproduce the failure at a known commit/environment.
2. Add or identify a test that fails for the right reason.
3. Fix the owner/mechanism rather than the assertion symptom.
4. Run the focused test, neighboring contract/lifecycle tests, and applicable browser suite.
5. Check the failure does not disappear only because of timing, retries, hidden skips, or a changed fixture.

## Prohibited shortcuts

- Deleting, skipping, weakening, or widening timeouts solely to make a test green.
- Calling a test “flaky” without reproducing and identifying the uncontrolled state.
- Treating one successful run as proof against a known race.
- Claiming UI/browser behavior from unit tests or types alone.
- Requiring arbitrary repeated runs when no race hypothesis exists.
- Updating snapshots without reviewing the semantic difference.

## Completion evidence

- selected suites are justified by the changed mechanism;
- the regression test fails before and passes after the fix when reproducible;
- focused and neighboring tests pass;
- applicable Chrome/HALO/production gates pass;
- no unexpected skip, retry, warning, artifact, open handle, or leaked process remains;
- environment/browser/version constraints are recorded when they affect the result.