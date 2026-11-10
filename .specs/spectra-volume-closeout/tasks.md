# 任务清单

- [x] T1 `audio-graph-router.ts`：`setParam` 增加 `cancelAndHoldAtTime` 优先路径与旧路径回退。
- [x] T2 `audio-graph-router.spec.ts`：扩展 fake 并新增 ramp 连续性用例。
- [x] T3 `hotkey-volume-tone.ts`：抽出 `captureActive`；settled 改为只消费 ACK 事实。
- [x] T4 `hotkey-volume-tone.spec.ts`：更新 settled 语义断言。
- [x] T5 运行 `bun run typecheck`、`bun run lint`、`bun run verify:q`、`bun --cwd nexus/apps/extension-spectra test:unit`，只修真实回归。
- [x] T6 汇报 diff 摘要（不提交），确认 `control-coordinator.ts` 未改动。
