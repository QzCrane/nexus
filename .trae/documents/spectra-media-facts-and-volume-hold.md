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

**验收结果（本轮）**：`test:unit` 112 文件全绿（含 `popup-inventory-latency.spec.ts` 真实浏览器）；`typecheck`、`lint`（388 文件 0 诊断）、`verify`（0 错误，1 个既有非阻断 warning：control-coordinator.ts 2636 行 vs review signal 2600）、`build`（service-worker wake 259.0KiB < 270KiB，bootstrap 13.2KiB < 14KiB）全通过。延迟实测：cold ~243ms / warm ~203ms 媒体卡片首帧，`mediaInventory: "complete"`（readNow 零 probe 投影）。

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
