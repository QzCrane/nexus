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

- [x] T6 注册即准入（R1，content）
  - `src/content/core/media-registry.ts`：`register()` 末尾在 `emit('registered')`
    之后，对“注册时已在播放”（`!element.paused`）的元素执行
    `admitBetterCandidate(true)`；暂停钉住/显式选择/全屏与 PiP 保护语义不变。
  - 不改 `discover` 的批量建立顺序，不改 `selectRecord` 的 identity/visit 语义。
  - 验证：`test/media-registry.spec.ts` 新增三条用例（已在 spec §5 列明）。

- [x] T7 观测证人是元素本身（R2，content）
  - `src/content/logic/native-media-executor.ts`：
    `handleMediaEvent` 的 `volumechange` 与 `flushPageObservations` 的选中重读中，
    `volumeBase`/`mediaMuted` 一律取事件元素自身（复用 `readElementVolume`），
    其余字段保留 `read()`；`observed` 缓存只与元素证人值比较。
  - 验证：`test/native-media-executor.spec.ts` 新增 delegate 返回相同 applied 值时
    仍产生 patch 并提交页面观察的用例。

- [x] T8 使用事实边界（R3，background + content）
  - `src/content/logic/policy-executor/config-updater.ts`：删除
    `if (!options.isNativeSync) state.userHasInteracted = true` 推断；
    `isNativeSync` 只保留“抑制 applyState”。
  - `src/content/logic/message-handler.ts`：用户来源命令
    （`spectra.hotkey.trigger`、`spectra.media.*`、`spectra.video.*`）在分发前调用
    `policyExecutor.markUserInteracted()`；`spectra.audio.runtime.configure` 不标记。
  - `src/background/handlers/badge.ts`：`updateBadgeFromSession` 与
    `updateBadgeFromControlProjection` 只读 `hasBadgeUsage`，
    删除 `resolveStickyUsage(tabId, userInteracted)` 的写入分支；
    只有 `recordSuccessfulExtensionUse`（popup/hotkey）调用 `markBadgeUsed`。
  - `src/background/lifecycle.ts`：`chrome.tabs.onCreated` 清理该 tabId 的用途；
    `badge-usage.ts` 的注释同步为“创建与关闭都是生命周期边界”。
  - 验证：`test/badge-volume-state.spec.ts` 新增三条用例（已在 spec §5 列明）。

- [x] T9 文档投影（第二轮）
  - `apps/extension-spectra/docs/architecture/runtime.md`：注册即准入、观测证人。
  - `apps/extension-spectra/docs/control/05-control-state.md`：用途只由已确认手势产生。
  - `apps/extension-spectra/docs/control/09-failure-index.md`：更新 §22.3 与角标条目。
  - 验证：`bun run docs:check`。

- [x] T10 门禁与交付
  - `bun run typecheck`、`bun run lint`、`bun run verify:q`、`bun run test:unit`。
  - `bun run build:spectra`。
  - 单提交：`fix(spectra): observe media documents without opening popup`。

- [x] T11 页面手势用途证人（R4，content → background）
  - `packages/contracts/src/control.contracts.ts`：`ControlSubmitRequest` 增加
    `userGesture?: boolean`，合同只允许 `source=page` 携带；加入 key 集合。
  - `native-media-executor.ts`：`volumechange` 到达时读取
    `navigator.userActivation.isActive`，随排队页面观察提交 `userGesture`；
    attach/选中发布等非手势路径恒为 false。
  - `control-coordinator.ts`：准入带 `userGesture` 且含 `volumeBase`/`mediaMuted`
    的页面观察前 `markBadgeUsedForTab`，使角标由观众拖动站点原生音量条创建并
    立即绘制该值；无激活的程序化写入仍不能创建角标。
  - 测试：`control-contracts` 的 page-only 断言、`native-media-executor` 的
    激活/非激活对、`control-coordinator` 的"自动播放不画、手势立即画"。
  - 文档：spec §4.4 R4 / I10 修订、05-control-state、09-failure-index。
