# SPECTRA 音量控制缺陷收口（决策完成规格）

状态：已核验，等待批准后执行。范围仅限经二次核验仍成立的缺陷；已撤回的结论不进入实现。

## 已核验结论

### A. `control-coordinator.ts` 阶段顺序：不修改

- 位置：`nexus/apps/extension-spectra/src/background/control-coordinator.ts` 的 `stageOrder`（约 L2109-2113）。
- Content 侧执行顺序：`nexus/apps/extension-spectra/src/content/logic/native-media-executor.ts` 的 `execute()` 先应用 `directEntries`（页面音量），再应用 `runtimePatch`（boost，约 L922-995）。
- 800% → 50% 的物理路径：
  - 现状 `['processor','target']`：800 → 100 → 50，峰值 100。
  - 改为 `['target','processor']` 或合并为单 intent：800 → 400 → 50，峰值 400。
- 结论：现实现是“页面音量 + 处理器增益”两个物理 owner 约束下峰值最小的合法路径；任何“让领先 stage 携带最终 volumeBase”的改法都会把瞬时峰值放大 4 倍。保持 `stageOrder`、补偿顺序 `[...stageOrder].reverse()` 与每 stage 断言不变。

### B. `setParam` 的 ramp 连续性：修复

- 文件：`nexus/packages/features/audio-engine/src/audio-graph-router.ts`，函数 `setParam`（约 L112-124）。
- 根因：`cancelScheduledValues(time)` 会删除进行中 ramp 的终点事件，随后读取 `param.value` 不再保证得到该 ramp 的当前值；连续滑动可能从上一次事件的旧值重新起 ramp，形成可听跳变。`cancelAndHoldAtTime` 是 Web Audio 为此提供的原语。
- 改法：
  - `durationMs === 0`：保持 `cancelScheduledValues` + `setValueAtTime`。
  - 其余：优先 `cancelAndHoldAtTime(time)` + `linearRampToValueAtTime(value, time + durationMs/1000)`；运行时不支持时回退现有路径。
  - 所有调用点（`applyLevel`、`buildLane` fade、`updateLane`）经同一函数收敛，不新增第二个 ramp owner。
- 不变量：替换 ramp 不得回退到旧值；ACK 语义不变（调度即 ACK，文档输出读回路径不变）。

### C. `resolveSettledVolumeTone` 的越权预测：修复

- 文件：`nexus/apps/extension-spectra/src/content/ui/hotkey-volume-tone.ts`。
- 根因：结算帧委托给 `resolveHotkeyVolumeTone`（`predict: true` + `prospectiveBoostRoute`），在 Capture 仅 `starting` 或最终失败时也把 pill 涂成 `capture`，违反 `nexus/apps/extension-spectra/docs/control/05-control-state.md` §11.2（L249、L302）：结算后的 tone 只消费已确认事实。
- 改法：
  - 抽出单一 `captureActive(facts)` 谓词（仍由 `resolveAudioVolumeState` 判定）。
  - `resolveHotkeyVolumeTone` 保持手势预测：`predict: true`、`prospectiveBoostRoute`、`boostRoute` 后备。
  - `resolveSettledVolumeTone` 只传 `volume/muted/enabled/captureActive`；不读 `prospectiveBoostRoute`，不使用 `boostRoute` 后备，与 ACK 路径 `audioVolumeStateToVolumeTone(resolveAudioVolumeState(...))` 同源。
  - `refreshHotkeyVolumeTone` 调用签名不变；多余字段被结构性忽略。

## 测试与验证

- `nexus/apps/extension-spectra/test/audio-graph-router.spec.ts`：`FakeAudioParam` 增加 `cancelAndHoldAtTime` 记录；新增用例证明替换中的 ramp 先 hold 再 ramp，且不调用 `cancelScheduledValues`。
- `nexus/apps/extension-spectra/test/hotkey-volume-tone.spec.ts`：既有“首次 crossing 使用 policy candidate”用例改为断言 settled 忽略 candidate；“settled frame is the gesture frame”拆为“无预测事实时两者一致”与“有 prospective 时 settled 只认 ACK”。
- 门禁：`bun run typecheck`、`bun run lint`、`bun run verify:q`、`bun --cwd nexus/apps/extension-spectra test:unit`。
- 不提交 commit；不改无关脏文件；除本 spec/tasks 外不新增文档。

## 批准

需要用户批准后进入实现。
