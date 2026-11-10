# 任务清单：条件让出 Alt+Up + 文档调用授权锁存 + 音量自由步进

- [x] T1 内容：`apps/extension-spectra/src/content/core/bootstrap.ts`
  - `volumeUpNeedsCommand()`：仅当页面主媒体 `volume >= 0.999` 且文档尚无扩展调用授权
  - 让出时只 `stopImmediatePropagation`，不 `preventDefault`，让页面 handler 无法取消命令和弦
  - 上限以下与已授权文档继续由 Bootstrap 独占，保留连发合并
  - 更新归属注释

- [x] T1b 共享态：`shared/content-runtime.ts` + `logic/policy-executor/index.ts`
  - ~~`ContentBootstrapState.captureOwned`~~（已被 T7 的 `extensionInvoked` 取代）
  - 每次模式应用后，`actualMode === 'capture' && phase === 'active'` 时锁存授权；dispose 不复位

- [x] T2 契约：`packages/contracts/src/control-value-limits.ts`
  - `stepEffectiveVolume` 移除十点网格与平局取整
  - 仅跨 100 时落到 100，其余返回原值

- [x] T3 单测：`test/control-contracts.spec.ts`
  - 自由步进断言：87+10=97、87-10=77、63+10=73、105+10=115、95-10=85

- [x] T4 Smoke
  - `test/smoke/harness.ts`：`pressDefaultHotkeyFromContent` 发送手势准入的 Content 信封
  - `test/smoke/hotkeys.spec.ts`、`test/smoke/capture.spec.ts`：Alt+Up 用例使用信封

- [x] T5 文档
  - `docs/control/02-strategy-and-routes.md`（调用边界、Alt+Up 归属、授权锁存）
  - `docs/control/05-control-state.md`（音量步进自由）
  - `docs/architecture/runtime.md`、`docs/architecture/media-source-admission.md`
  - `docs/guide/01-extension-primer.md`、`docs/guide/00-web-primer.md`

- [x] T6 验证（2026-11-10 全绿）
  - `typecheck`、`lint`、`verify:q`（0 errors / 7 warnings）、`docs:check`（153 files）
  - `test:unit`（SPECTRA）
  - `test/smoke/hotkeys.spec.ts` 7 pass、`test/smoke/capture.spec.ts` 7 pass、`test/smoke/document-output.spec.ts` 2 pass / 1 skip
  - `build:dev`
  - 交付提醒：扩展与页面需各重载一次，document_start 脚本才会替换

- [x] T7 根因修正：调用授权是文档生命周期事实（2026-11-10）
  - `shared/content-runtime.ts`：`ContentBootstrapState.extensionInvoked` + `markContentExtensionInvoked()`，文档内只置 true
  - `background/extension-invocation.ts`：`grantContentInvocation(tabId, documentId)`，用 `{ documentId }` 精确投递
  - `control-coordinator.ts`：Popup identity 解析成功即投递（Popup 打开 = invocation）
  - `shortcuts.ts`：manifest 命令送达且前台文档即目标文档时投递
  - `content/core/bootstrap.ts`：消费 `spectra.content.invocation.granted`；同文档重注入沿用锁存
  - `packages/contracts/src/spectra.bootstrap.ts`：授权消息 + 严格 guard
  - 单测：`test/spectra-protocol.spec.ts` 覆盖授权消息正反例

- [x] T8 验证（第二轮，2026-11-10 全绿）
  - `typecheck`（6 packages）
  - `lint`（6 packages，0 diagnostics）
  - `verify:q`（0 errors / 7 warnings；`rpc-deadlines` 登记一次性授权通知；remote projection 重新生成）
  - `docs:check`（153 files）
  - SPECTRA `test:unit`（136 files，含新增 gate 单测与授权消息正反例）
  - `test/smoke/hotkeys.spec.ts` 7 pass、`test/smoke/capture.spec.ts` 7 pass、`test/smoke/document-output.spec.ts` 2 pass / 1 skip
  - `build:dev`
  - 交付提醒：扩展与页面需各重载一次
