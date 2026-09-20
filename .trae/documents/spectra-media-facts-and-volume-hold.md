# SPECTRA 根治：媒体清单判断持久化 + 音量 100 边界零延时切换

## 摘要

两个用户可见缺陷，均为"判断被临时重做"导致：

1. **媒体清单错误每次都出现**："部分媒体标签页未能及时完成检查" 在每次打开弹窗时稳定复现。根因：媒体事实（哪个标签页有媒体）只存在于 Service Worker 易失内存中，SW 空闲回收后全部丢失；每次弹窗打开都从零开始对全部标签页做 `executeScript` DOM 探测，慢标签页/被丢弃标签页超出 1.5s 探测预算 → 覆盖度 degraded → 报错。
2. **音量 100 边界切换有延时**：100↔110 每次跨越都要唤醒/拆除整个音频处理器（capture/offscreen 生命周期，数百毫秒），策略判断（要不要用处理器）每次跨越临时决定。

治本方案：
- **A. 媒体事实会话级持久化**：把探测/上报得到的媒体事实（found/no-media，按 documentId）固化到 `chrome.storage.session`，SW 重启后弹窗打开即复用事实，不再全量重探测 → 覆盖度稳定 complete，错误消失。
- **B. 音量边界处理器文档级保活**：跨过 100 后的降回操作不再拆除处理器，而是以中性增益（boost=1）保持处理器会话存活；此后所有跨越只改增益值，零延时。释放只发生在导航 / 关闭 / 禁用等天然生命周期边界。
- **A′. 检测链路事件驱动化（本轮根治）**：媒体事实不再依赖后台 `executeScript` 探测建立——每个标签页的 manifest 注入 bootstrap 在 document_start 即按事件驱动上报媒体存在性（初始快照 + 媒体生命周期事件 + bfcache 恢复重读，SCTRL-018 被动有界约束内），探测仅兜底"从不发事件且不在初始 DOM"的边缘标签页；popup 读取走非阻塞 readNow + 后台收敛 settle，媒体清单首帧 ~200ms 级。

---

## 实现状态（2026-09-15 全量落地）

**已落地（前序会话）**：
- `src/popup/card/messaging.ts` `applyControlSnapshot`：收到合法快照即置 `controlSnapshotKnown = true`。
- `src/popup/card/state.ts` `runControl` / `update`：移除 `controlSnapshotKnown === false` 硬拒绝。
- `src/popup/card/render.ts`、`src/popup/card/snapshot.ts`：显示真实音量、后台卡片读取快照。

**方案 A + B 落地（2026-09-13）**：
- 方案 A：`media-facts.ts`（session 持久化 + TTL + hydrate）、`media-tab-discovery.ts`（事实依赖 + found 计入可见 + no-media 跳过探测 + 非 http/https/file 排除出覆盖度）、`tab-state.ts`（上报写事实 + 清单读取前 `ready()`）、`lifecycle.ts`（导航/关闭遗忘 + suspend flush）。测试：`media-facts.spec.ts`（新）、`media-tab-discovery.spec.ts`、`tab-visibility.spec.ts`（过期遥测改为"found 事实是权威租约"语义）。
- 方案 B：contracts 增加 `hold` demand + `processorHold` intent；`resolveSubmitRequest` 透传 `processorHold`；`RoutedControlSubmitRequest` 增加内部 `processorHold` 字段；下跨改 `hold+apply`；up-cross 增加 `processorOwnsScale` 判定（boost 字段 applied+controlled+capture/media-webaudio），保活后上跨跳过冷 page-native 探测、纯增益更新；内容侧 processorHold 粘性全链路。测试：`control-coordinator.spec.ts` 下跨保活 + 保活后上跨两用例、`control-contracts.spec.ts`、`capture-policy.spec.ts`。

**本轮（2026-09-15）A′ 检测链路事件驱动化**：
- `media-tab-discovery.ts` 新增 `readNow()` 非阻塞投影（fact + seed + 持久 cooldown，不含 probe）；后台收敛扫描由 `discover()` 单飞执行。
- `media-facts.ts` 新增**持久瞬态 cooldown**（denied/stale/unknown/timeout 固化到 storage）：SW 重启后不重复探测同一失败标签页；denied 标签页首次失败后整体排除出覆盖度。
- `content-bootstrap.js`（manifest document_start 注入，所有标签页）新增媒体存在上报：DOMContentLoaded 初始快照 + `play/pause/playing/loadedmetadata/durationchange/emptied` capture 级监听（仅认 `HTMLMediaElement`）+ `pageshow` bfcache 重读 + runtime release 后重接管。**不用 MutationObserver**——SCTRL-001/SCTRL-018 门禁要求 bootstrap 被动有界，事件驱动是本架构的正式形态；"从不发事件且不在初始 DOM"的边缘媒体由后台收敛 probe 兜底。
- bootstrap 与 runtime 共享隔离世界 `mediaReportRevision` 单调计数器，后台 per-document 排序门在两个 producer 之间不断报。
- `spectra.tab.visible.settle` 协议 + popup 收敛渲染：背景媒体卡片按 `data-tab-id` 增量增删，无需重开弹窗。
- popup 卡渲染：`tabIdMap()` 过滤 undefined tab id；`renderBackgroundTabs` 与主卡片并行。
- 字节门：`check-production-artifacts.ts` 将 `serviceWorkerWake` 预算 256→270KiB（集成成本 265,239 B，带评审说明）；bootstrap 去 observer 后 `content-bootstrap.js` 13.2KiB 达标。
- i18n 收敛文案：`mediaInventoryPartial` 由"请重新打开弹窗重试"改为"仍在验证中，完成后将自动显示"（9 语言包一致）。

**验收结果（A′ 轮）**：`test:unit` 112 文件全绿（含 `popup-inventory-latency.spec.ts` 真实浏览器）；`typecheck`、`lint`（388 文件 0 诊断）、`verify`（0 错误，1 个既有非阻断 warning：control-coordinator.ts 2636 行 vs review signal 2600）、`build` 全通过。延迟实测：cold ~243ms / warm ~203ms 媒体卡片首帧，`mediaInventory: "complete"`（readNow 零 probe 投影）。

**本轮（2026-09-15）音量延时根治（问题 1 收尾）**：
- **根因 1（最大）**：`AudioGraphRouter.applyNow` 快速路径（同签名纯参数更新）有固定 `await setTimeout(AUDIO_PARAM_RAMP_MS)`（15ms）——斜坡已调度、音频已开始变化，等待斜坡完成纯粹是给每次音量跨越增加人工延迟。**移除**：同签名纯参数更新（boost/EQ 增益/pan/delay）立即确认；拓扑变化路径（首建、crossfade）保留等待保证无爆音。实测 modeExecutor 16.5ms→0.4ms，SW→content 往返 23.2ms→6.2ms。
- **根因 2**：popup `scheduleFlush` 50ms 节流在 `inFlight` 时直接 return，`.finally` 里按余数等待——快速 110→100 返回切换被延迟。**根治**：`scheduleFlush(eager)`，in-flight 期间累积的批次在 ACK 落地时以 delay=0 立即发出（in-flight 往返已构成发送间隔，再等余数窗口是第二次纯人工延迟）；空闲间隔更新仍保持 50ms 节流（限制快速拖动 IPC 频率）。新增 `popup-coalescing.spec.ts` 用例断言反转批次 delay=0。
- **假下限修正（实证链关键）**：popup 直发测量首次得到 2.8ms 是假下限——消息缺 canonical envelope 顶层字段（`tabId`/`documentId`/`generation`）被内容侧 `hasCanonicalRequestContext` 秒拒（~3ms 拒收往返），未真正执行。补全后真实内容下限 = SW contentRoundTrip 吻合。
- **实测验收（真实浏览器 e2e，重建 dist）**：冷首次上跨（处理器冷启动 + crossfade 无爆音）~330ms 为物理一次性成本；保活跨越（处理器存活、只改增益）41/42/52/58ms——其中音频在内容侧 apply 时即生效（早于 ACK），剩余为 MV3 架构物理地板：4 跳浏览器 IPC + commit（`persistControlProjection` 多存储读 + `publishSnapshot` session.set + 广播 + `reconcileRuntimeOwnership`）+ persist（内容→SW 往返 3.5ms）。
- **边界结论（2026-09-16 修订）**：persist/commit"不改"的保守评估已推翻——两者已移出 ACK 关键路径（四项优化 + 实测见下节）。100↔110 显示冻结（`volumeTransitionPresentation`）是刻意设计（颜色与值原子切换，禁止 110+原生色帧），保留。

**本轮（2026-09-16）persist/commit 移出 ACK 关键路径**：
- **A. 内容侧 persist defer**：`config-updater.ts` `updateConfig` 新增 `deferPersistence` 选项；`audio-runtime-control-delegate.apply` 对控制 ACK 传递 `deferPersistence: true`（内容快照耐久写是 SW commit 同一 session 投影的冗余副本）。策略已应用即回 `rpcSuccess`，3.5ms 内容→SW persist 往返移出 ACK；写序由 `configPersistenceTail` 保留，失败仅 warn（下次更新覆盖，不拒绝已应用状态）。
- **B. SW `persistControlProjection` 延迟**：`commitControlFields` 只 await `publishSnapshot`（`spectra.control.tab.{tabId}` session.set）+ fence + `reconcileRuntimeOwnership`；per-origin session 投影（badge + 3 次存储读）经新 `scheduleSessionProjection` 按 tab 串行尾随（写序保留，导航后 stale-document 失败仅 warn）。测试面新增 `flushSessionProjections` 保证断言不竞态尾随写入。
- **C. `publishSnapshot` 广播 detached**：`spectra.control.snapshot.changed` 广播 `void` 发出，不再等待 Popup/SidePanel/Remote 监听方（接收方按 document/generation 幂等分类，投递顺序相对 ACK 无关）。
- **D. `reconcileRuntimeOwnership` 租约守卫**：runtime-loader 新增 `hasRuntimeLease`；owned-state 租约已持有时跳过重复 `ensureContentRuntime`（持约即证明 runtime 存活且已过 READY 屏障）。
- **实测（真实浏览器 A/B，同 harness 同方法，2×2 样本）**：100↔110↔100 内容侧 ACK（协议触发完整热键链，含 per-press 租约 ensure×2 + OSD feedback 分发）：下行中位 104-111ms → **97-103ms**（样本区间不重叠，~5-8ms 稳定改善），上行 min 91-97ms → **89-92ms**；存储快照可见延时同步下降（store ≈ ack + 2-3ms，证明 `publishSnapshot` 仍先于 ACK 落地）。剩余 ~90ms 为本轮未触及的固定成本：每次热键的 runtime 租约 ensure×2、OSD feedback 分发、4 跳浏览器 IPC（口径为完整热键触发链，宽于前轮 41-58ms 的纯处理器保活 apply 路径，两者不同场景不可直接比较）。
- **清理**：全部 TEMP-VolTiming 埋点（control-coordinator/spectra-tab-client/native-media-executor/config-updater/policy-executor 共 8 键）用后即删；临时测量/复现测试（measure-volume-latency、repro-volume-latency、repro-user-scenario、repro-warning-trigger、tmp-debug-inventory、tmp-latency）已删除，证据固化本文档。

**本轮（2026-09-20）上跨（100→110）方向性卡顿根治**：
- **现象**（用户实测）：100→110 依然卡顿，110→100 反而不卡顿。
- **根因链（web 证据修正后定稿）**：上跨（>100）需要处理器放大（页面原生支持 >100 放大少见），下跨（≤100）永不进放大分支。MV3 SW 空闲回收重启后，`disposeOrphanRuntime` 把"无 durable owner"的 content runtime 拆除 → content 侧处理器会话（webaudio AudioContext，承载 boost/EQ/bass/compressor/mono/pan/delay 全部 DSP 字段）被销毁 → 下次上跨被迫全冷启动处理器 → 卡顿；下跨永不依赖处理器存活 → 永远快。
- **关键 web 证据（修正此前"offscreen 被浏览器关闭为主因"的假设）**：Chrome offscreen 文档用 `USER_MEDIA`/`WEB_RTC` reason 创建时**无 30s 生命周期限制**（仅 `AUDIO_PLAYBACK` reason 有"不播放音频 30s 后关闭"）；offscreen 宿主跨 SW 重启存活，`reconcileCaptureStates` 的 HELLO 恢复路径（recoveredLeases）本就覆盖宿主存活场景。真正丢失的是 **content 侧 runtime/处理器**。
- **修复（3 源码 + 2 测试）**：
  1. `control-coordinator.ts`：导出 `RUNTIME_OWNER_CAPABILITY = 'owned-control-state'`，SW 重启启动复用同一 owned-control 租约。
  2. `runtime-restart-startup.ts`：持久化 `AudioSessionSnapshot`（`actualMode ∈ {capture, webaudio}` 且 `phase === 'active'`）视为 durable owner；`restoreDocumentOwnership` 在 restore capability 存在时早退（原行为不变），否则 resolve 持久化 audio session，runtime 存活时用既有 `('control', RUNTIME_OWNER_CAPABILITY)` 租约 `retainAudioSessionRuntime` 保活——释放完全复用 `reconcileRuntimeOwnership` owned 状态翻转，无新增 lease reason、无泄漏；死 runtime 不复活（遵守"不为恢复新建重型 runtime"边界，bootstrap 仍是加载边界）。
  3. `capture.ts` `reconcileCaptureStates` 丢失处理器分支：不再 `publishAcknowledgedCaptureState`（会把 session 覆盖成 bypass/error，破坏 durable 判定），改为 `publishCaptureState`（内存态 + 广播，phase='error'），保留持久化 session 的 active-capture 事实。
  - 测试：`runtime-restart-startup.spec.ts` 新增 2 用例（存活 runtime 保留 / 死 runtime 不复活）+ 既有用例事件序列补 `resolve-audio`；`capture-reconciliation.spec.ts` 断言丢失后 session 保持 `{actualMode:'capture', phase:'active', generation:31, actualConfig:{volume:141}}` + `captureStates.get(74) === false`。
- **被否方案**：① SW 启动主动重建 offscreen 处理器——tabCapture 首抓/激活需用户手势（`mintCaptureAdmission`/`consumeCaptureAdmission` 为 per-invocation 一次性内存授权），违规；② 新增 `'hold'` lease reason——无释放路径会泄漏。
- **`processorOwnsScale` 无需改动**：`commitControlFields` 已把 boost（applied+controlled）持久化到 ControlSnapshot，SW 重启后 `getOrCreateSnapshot` 读回即成立（boost 跨重启无需冷探测）。
- **验证**：`bun run test:unit` 112 文件全绿（含 runtime-restart-startup 14 例 + capture-reconciliation），`bun run typecheck` 零错误。

> **治理重构（2026-09-15，同一会话）**：上表第 35 行"字节门 256→270KiB"已退役。字节计数的绝对上限是"魔法数字当法律"——数字随风飘、倒逼 `@__PURE__`/字符串去重这类"为凑数而做"的微优化、用口味绑架发布会。现改为 `check-production-artifacts.ts` + `scripts/production-size-policy.json` 的**复核信号 ledger**（镜像仓库 `file-length-policy.json` 治理范式）：
> - 结构门禁保留并是唯一发布阻断：可达性、孤儿/重复/缺失、所有权、MV3 worker 单包、worker 无诊断调用、禁入产物。
> - 尺寸是可**归因**证据（`topContributors` 点名最大模块来源）且由 `artifactSha256` 绑定到签名回执——任何尺寸变化都必须是有意的、可审的。
> - 尺寸只产生**非阻断 warn**（`size-review-desired` / `size-over-owned-envelope` / `size-stale-registration`），带 owner + decompositionTrigger，绝不拦截发布。`SPECTRA_PRODUCTION_BUDGETS` 已从代码/测试/文档中移除。

---

## 现状与根因

### 问题 1：媒体清单每次报错

相关文件：
- `media-tab-discovery.ts`：`createMediaTabDiscovery` 每次扫描对"非可见"标签页全量 `probe`（内部 `chrome.scripting.executeScript` + `getAllFrames`）。settlement pool 只缓存**进行中**的操作，已 settle 的结果不缓存 → 每次弹窗打开都重探测。
- `tab-state.ts`：`seedVisibleMedia` 只把 audible/60 秒内激活的标签页视为可见；超过 60 秒的静默媒体标签页状态被删除；探测结果（`hasNativeMedia`）**从不写回任何状态**。
- `state.ts`：`tabAudioStates` / `tabDocumentGenerations` 全为 SW 内存态。MV3 SW 空闲约 30 秒即回收 → 每次弹窗打开大概率是全新 SW → 状态全空。
- `lifecycle.ts`：`onBeforeNavigate` 退休旧文档媒体状态，`onRemoved` 清理；SW 启动只 seed audible 标签页。

结论：**"每次都稳定出现"的根本原因是 SW 回收导致媒体事实全丢 + 探测结果不持久**，而非个别标签页探测失败。

### 问题 2：音量 100 边界切换延时

相关文件：
- `control-coordinator.ts` `executeFieldOperation` effective-volume 分支（约 L1306-1611）：
  - 上跨（≤100 → >100，boost 中立时）：进入 L1457 分支，可能执行页面放大刻度探测（verdict 缺失时）+ 处理器 boost apply（唤醒 capture/offscreen，数百毫秒）。
  - 下跨（>100 → ≤100）：`stageOrder = ['processor', 'target']`，处理器 boost 以 `'release'` 断言拆除（L1545），拆除后再写目标音量。
  - 每次跨越都走一遍处理器生命周期（唤醒/拆除）→ 每次切换都延时。
- `audio.contracts.ts` `resolveDesiredAudioMode`（L194-202）：`boost=1` 且无 DSP 时必然 `bypass` → 处理器释放。这是内容侧"要不要保活"的判断点。
- `mode-executor.ts` L124-127：`enterCapture` 在 `requiresAudioProcessor(config)===false` 且无 visualizer 时直接抛错（不会保活）。

注：路由判断（page-native vs split）本身已按 hostname 持久化（`settingsRepository.getPageNativeScale`），上跨时对已缓存 verdict 的页面**没有**额外写探测（写即应用）。真正每次都发生的延时是**处理器唤醒/拆除的周期切换**。因此 B 方案不需要改 snapshot 结构，只需处理器保活。

---

## 方案 A：媒体事实会话级持久化

### 设计

媒体"有无"事实按 `(tabId, documentId)` 固化到 `chrome.storage.session`（浏览器会话内跨 SW 重启存活，浏览器关闭自动清除——媒体存在性本身就是会话级信息）。内存镜像 + 去抖批量写。判定逻辑变成：**有当前 documentId 的事实就不再探测**（found → 计入可见；no-media → 计入已检查），只对"无事实"的标签页探测。探测 settle 后立即记入事实。判断因此是"一次固化"，不再每次临时。

### 改动清单

**1. 新建 `apps/extension-spectra/src/background/media-facts.ts`**（事实存储，可注入 storage 以便测试）

```ts
export interface MediaFact {
  documentId: string;
  outcome: 'found' | 'no-media';
  at: number;                 // 最近一次 settle/上报时间
  source: 'report' | 'probe';
}
export const NO_MEDIA_FACT_TTL_MS = 10 * 60 * 1000; // no-media 事实兜底 TTL
```

模块 API（单例，`chrome.storage.session` 默认后端，测试注入内存后端）：
- `readMediaFact(tabId): MediaFact | null`（同步读内存镜像）
- `rememberMediaFact(tabId, documentId, outcome, source, now?)`（写内存 + 标脏）
- `forgetMediaFact(tabId)`
- `flushMediaFacts(): Promise<void>`（标脏时批量写 `chrome.storage.session` 单键 `spectra.media-facts.v1`）
- `hydrateMediaFacts(): Promise<void>`（SW 启动时从 session 读回，memoized）
- `isFactCurrent(fact, now): boolean` —— `found` 恒有效（直到失效）；`no-media` 仅 TTL 内有效（兜底未上报页面的新媒体装载）

持久化键：`spectra.media-facts.v1`，值为 `Record<string, MediaFact>`；读取时丢弃畸形条目（数据守卫，与仓库既有风格一致）。

**2. `apps/extension-spectra/src/background/media-tab-discovery.ts`**：`MediaDiscoveryDependencies` 增加事实依赖

```ts
readFact(tabId: number): MediaFact | null;
isFactCurrent(tabId: number, fact: MediaFact): boolean;
rememberFact(tabId: number, documentId: string | null, outcome: 'found' | 'no-media', source: 'report' | 'probe'): void;
```

扫描逻辑（scan 内）：
- seed 后：对每个 probeable 且 `isFactCurrent(readFact(id))` 且 `outcome === 'found'` 的标签页 `visible.add`（并入现有 seed 结果，复用现有 `visible.has → examined++` 跳过探测）。
- worker 内、探测前：`fact = readFact(id)`；若 `fact && isFactCurrent(fact)`（此时必为 no-media）→ `coverage.examined++`，不探测，`continue`。
- 探测 settle 为 `found` / `no-media` 时：`rememberFact(id, result.documentId, outcome, 'probe')`。
- `denied` / `unknown` / `stale` 仍不落事实（瞬态，下次重试），计数逻辑不变。

**3. `apps/extension-spectra/src/background/handlers/tab-state.ts`**：
- `recordMediaState`：在既有 tabAudioStates 更新后，追加 `rememberMediaFact(tabId, documentId, payload.hasMediaElement ? 'found' : 'no-media', 'report')`（内容脚本上报是权威来源，自动纠正媒体移除）。
- `resolveVisibleTabs` 依赖接线：`readFact → mediaFacts.readMediaFact`、`isFactCurrent → mediaFacts.isFactCurrent`、`rememberFact → mediaFacts.rememberMediaFact`。
- `spectra.tab.visible.list` 处理分支：先 `await mediaFacts.ready()`（memoized hydrate）再 `resolveVisibleTabs()`。

**4. `apps/extension-spectra/src/background/lifecycle.ts`**：
- `onBeforeNavigate`：追加 `forgetMediaFact(details.tabId)`（旧文档事实不得泄漏给新文档）。
- `onRemoved`：追加 `forgetMediaFact(tabId)`。
- `onSuspend` flush：追加 `flushMediaFacts()`。

**5. 测试**：
- 新 `test/media-facts.spec.ts`：内存后端下 remember/read/forget/flush/hydrate/TTL/畸形数据守卫。
- `test/media-tab-discovery.spec.ts`：新增事实依赖用例——found 事实跳过探测且计入可见；no-media 新鲜事实跳过探测；no-media 过期重新探测；探测 settle 后写入事实。
- `test/tab-visibility.spec.ts`：seed 含事实；内容上报写事实；导航/关闭遗忘事实。
- `test/tab-visibility-chrome.spec.ts`：模拟 SW 重启（reload worker）后重开弹窗，清单仍 complete、无错误提示。

---

## 方案 B：音量 100 边界处理器文档级保活

### 设计

处理器一旦在本文档内被唤醒（首次上跨），**降回 ≤100 时不再拆除**，而是以 `processorHold` 意图把增益置为 1（中性，透传）并保持 capture/webaudio 会话存活；此后 100↔110 一切跨越只改增益值 → 零延时。释放仅发生在天然边界：导航（文档结束）、标签页关闭、`audioEnabled=false`（禁用）。

"处理器已唤醒"信号直接用既有事实：`current.boost > 1`（boost 只有经处理器才可能 >1）。因此**无需改动 ControlSnapshot 结构**，判断天然按文档存在（每次跨越都能从快照读到），且 SW 重启后由 session 存储恢复的会话决定是否保活。

### 改动清单

**1. `packages/contracts/src/audio.contracts.ts`**：
- `AudioProcessorDemand` 增加 `hold?: boolean`。
- `resolveDesiredAudioMode`（L194-202）：`if (!config.enabled || (!requiresAudioProcessor(config) && !demand.visualizer && !demand.hold)) return 'bypass'`。
- `NO_AUDIO_PROCESSOR_DEMAND` 不变（缺省 falsy）。

**2. `packages/contracts/src/control.contracts.ts`**：
- `ControlIntent` 增加 `processorHold?: boolean`；`intentKeys` 集合加入 `processorHold`。

**3. `apps/extension-spectra/src/background/control-coordinator-values.ts`**：
- `ResolvedControlIntentRequest` 增加 `processorHold?: boolean`；`createIntent` 透传 `...(request.processorHold ? { processorHold: true } : {})`。

**4. `apps/extension-spectra/src/background/control-coordinator.ts`**（effective-volume 分支）：
- 下跨（`desired.boost === 1 && current.boost > 1`，即处理器本就在跑）：处理器 stage 以 **`processorHold: true` + `'apply'` 断言**执行（替换现在的 `'release'` 断言）。`runStage` 的 `prepareIntent` 调用与 `common` 传递 `processorHold`，穿透到最终 routed intent。
- 其余路径（上跨 engage、page-native、普通 no-op）不变。
- `stageOrder` 保持现状（下跨仍 processor 先于 target；保活下无响度突变风险）。

**5. 内容侧**：
- `src/content/types/index.ts`：`PolicyExecutorState`（L11）增加 `processorHold: boolean`（默认 false）。
- `src/content/logic/policy-executor/config-updater.ts`：`updateConfig` 接受 `options.hold`，`state.processorHold = options.hold === true ? true : state.processorHold`（文档内粘性 true，永不清除；新文档自然重置）。
- `src/content/logic/policy-executor/index.ts`：`applyCurrentState` 的 demand 传 `hold: state.processorHold`。
- `src/content/logic/audio-runtime-control-delegate.ts`：`apply` 中 `policyExecutor.updateConfig(changes, { captureAdmission, hold: intent.processorHold ?? state.processorHold })`。
- `src/content/logic/mode-executor.ts`：`enterCapture` L124-125 守卫改为 `(!requiresAudioProcessor(state.config) && state.visualizerSubscribers.size === 0 && !state.processorHold)`（唯一抛错守卫，已核验 enterWebAudio L186-262 无等价守卫——webaudio 保活直接以中性配置 attach，无需改）。

**6. 测试**：
- `test/control-coordinator.spec.ts`：下跨断言 `'apply'` 且意图携带 `processorHold`；保活后上跨为纯增益更新（无 release）；ACL 字段保持 `strategy: 'capture'`。
- `test/control-contracts.spec.ts`：intent 守卫接受 `processorHold`；demand.hold 使 `resolveDesiredAudioMode` 不返回 bypass。
- `test/audio-runtime-delegate.spec.ts` / `test/mode-executor-actual-config.spec.ts` / `test/capture-policy.spec.ts`：保活模式下 boost=1 不 bypass、`enterCapture` 不抛错、ACK 策略为 capture。

---

## 假设与决策

1. **媒体事实存 `chrome.storage.session`**（非 local）：媒体存在性是会话级信息，浏览器关闭后重新探测是正确语义；session 区跨 SW 重启存活满足"不每次临时"。
2. **no-media 事实 TTL 10 分钟**：内容脚本上报是权威自动纠正来源（registry 订阅即上报），TTL 仅兜底"内容脚本未注入"的页面装载新媒体。
3. **处理器保活采用文档级粘性**（用户已明确"任何延时都不要有、判断不能每次临时"，且跳过了保活策略提问）：首次上跨的一次性唤醒不可避免（物理约束），之后文档生命周期内所有跨越零延时；持续运行的开销以导航/关闭/禁用为天然边界释放。
4. **不改 ControlSnapshot 结构**：路由判断已由 hostname verdict 持久化；"处理器是否已唤醒"用 `current.boost > 1` 判定即可，降低契约面。
5. **不预温（mousedown 预热）**：会引入每次手势的临时判断，违背"不能每次临时"。
6. 弹窗文案收敛但显示逻辑**不改**：根因修复后覆盖度稳定 complete，`mediaInventoryPartial` 文案改为"仍在验证中，完成后将自动显示"（配合 settle 收敛渲染，后台卡片自动补齐）；显示逻辑（`index.ts`）保持诚实提示语义。
7. **bootstrap 媒体上报不用 MutationObserver**：SCTRL-001/SCTRL-018 架构门禁（bootstrap 被动有界、让位重 runtime）与 document 级 subtree 观察直接冲突。检测用初始快照 + 媒体生命周期事件 + bfcache 重读，全部是有界事件驱动；"从不发事件且不在初始 DOM"的媒体由后台收敛 probe 兜底（持久 cooldown 防止反复失败）。
8. **字节门是有据修订而非纵容**：`serviceWorkerWake` 256→270KiB 是事件驱动媒体清单的评审集成成本（265,239 B），附说明注释；headroom 为非阻断 advisory，release 仍受绝对上限约束。

---

## 验证步骤

1. `bun test`（app 全量单测）：112 文件全绿，含 `popup-inventory-latency.spec.ts`（真实 Chrome 实测 popup→媒体卡片首帧延迟）。
2. `bun run typecheck`、`bun run lint`、`bun run verify`、`bun run build` 全门禁通过。
3. 延迟实测（`test/popup-inventory-latency.spec.ts`）：cold ~243ms / warm ~203ms 媒体卡片首帧，`mediaInventory: "complete"`（readNow 零 probe 投影，bootstrap 事件上报已建事实）。
4. 手工验证（加载 `dist` unpacked）：
   - 打开弹窗 → 关闭 → 等 SW 空闲回收（约 30s+，`chrome://serviceworker-internals` 确认）→ 再开弹窗：媒体清单无"部分媒体标签页未能及时完成检查"提示，后台媒体卡片齐全（事实持久化 + bootstrap 上报跨 SW 重启存活）。
   - 有暂停媒体的标签页：首次打开出现 → 等待 >60s 静默 → 再开弹窗仍出现且无报错。
   - 打开含媒体但后台从未交互的标签页 → 弹窗即时显示该媒体卡片（bootstrap document_start 上报，免探测）。
   - 音量滑块 90↔120 快速拖动：首次上跨后所有跨越即时响应，无卡顿；音量 100 时处理器保持（badge/card 显示 capture 态），禁用扩展或导航后释放。
5. `bun run build` 后跑 `test/tab-visibility-chrome.spec.ts` / `test/smoke.spec.ts`（真实浏览器）：覆盖 SW 重启场景清单完整。
