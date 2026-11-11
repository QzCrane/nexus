# Tasks — SPECTRA 直播页自动接管与自动同步

> 规格：[spec.md](spec.md)。前提：`/follow` 与 `/follow/live` 同源，不是跨域问题。

- [x] T1 媒体出现即建立观察（background）
  - `src/background/runtime-loader.ts`：新增 `DOCUMENT_OBSERVATION_CAPABILITY` 与
    `ensureMediaObservation(tabId, documentId)`。
  - `src/background/handlers/tab-state.ts`：媒体上报 `hasMediaElement` 时调用，
    失败只记 warn。
  - 验证：`test/runtime-loader.spec.ts` 与媒体上报 handler 测试新增用例。

- [x] T2 attach 即发布（content）
  - `src/content/logic/native-media-executor.ts`：新增 `publishCurrentSelection()`。
  - `src/content/core/index.ts`：`bootstrapMessaging(...)` 后调用一次。
  - attach 无选中时挂起，第一次选中补发一次；SPA 切换选中另一个播放器元素时
    发布该元素自己的物理值；同一元素身份变化保持 target-only。
  - 验证：`test/native-media-executor.spec.ts` 新增“已有选中 → 发布一次”“无选中 →
    不发、首次选中补一次”“SPA 替换元素 → 发布新元素值”。

- [x] T3 worker 重启保留（background）
  - `src/background/runtime-restart-startup.ts`：port 增加
    `resolvePersistentMediaObservation` / `retainMediaObservationRuntime`；
    在无 restore、无 audio session 时按媒体事实保留 observation。
  - 验证：`test/runtime-restart-startup.spec.ts` 新增保留用例；
    既有孤儿回收用例仍绿。

- [x] T4 文档投影
  - `apps/extension-spectra/docs/architecture/runtime.md`
  - `apps/extension-spectra/docs/control/05-control-state.md`
  - `apps/extension-spectra/docs/control/09-failure-index.md`
  - 验证：`bun run docs:check`。

- [ ] T5 门禁与交付
  - `bun run typecheck`、`bun run lint`、`bun run verify:q`、`bun run test:unit`。
  - `bun run build:spectra`。
  - 单提交：`fix(spectra): observe media documents without opening popup`。
