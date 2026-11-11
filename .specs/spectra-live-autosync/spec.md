# SPECTRA 直播页自动接管与自动同步

- status: approved
- owner: spectra-control-runtime
- last_reviewed: 2026-11-11
- supersedes: 本目录前一版“跨 origin 会话迁移”方案（前提错误，已废弃）

## 1. 症状

`www.douyin.com/follow`（视频）与 `www.douyin.com/follow/live/<id>?anchor_id=...`
（直播）在同一标签页切换。切到直播后：

- 原生音量变化不进入角标，必须打开 Popup 才“同步上正确音量”；
- 第一次控制可能不生效，点开 Popup 后才正常；
- 刷新直播页后重复出现。

同一站点的视频→视频切换没有该问题。

## 2. 根因（同源，非跨域）

1. 直播路由是**新文档**，`restoreIfConfigured`
   （`apps/extension-spectra/src/background/runtime-loader.ts`）解析出的 patch 为空：
   没有站点预设、没有页面显式 portable 配置。
2. 空 patch 时该函数直接 `return`，**不执行 `ensureContentRuntime`**。
3. 内容侧的媒体上报会调用 `recordMediaState` → `resumeDocumentInitialization`
   （`src/background/handlers/tab-state.ts`），但该 document 的初始化条目
   已处于 `complete`，`beginDocumentInitialization` 只会返回旧 operation，
   **不会为“媒体已出现”补建运行时**。
4. `NativeMediaExecutor` 是 `volumechange` 观测与
   `spectra.content.target.changed` 的唯一发送者。运行时不存在，直播页的原生事实
   不会进入后台规范快照。
5. Popup 的显式读取冷启动运行时并补发当前值——这是唯一被观测到的路径。

补充竞态：即使运行时被提前创建，`NativeMediaExecutor` 构造时只
`primeObserved`，不会为“已经选中”的目标补发观测。若 restore 早于播放器出现，
attach 时无选中；首次选中只发 target，快照仍为空。

SPA 竞态：`/follow` → `/follow/live/<id>` 也可能在同一文档内完成，选中替换为
一个新的播放器元素。既有 `selected` 只发布 target，不发布物理值，于是角标保留
上一个播放器的数字，直到首次原生变化或 Popup 的显式读取。

结论：**“有媒体”没有成为观察所有权的加载边界**，观察被错误地绑在
“存在待写入值”上。

## 3. 不变量

- **I1 有媒体就必须有观察 owner**：文档上报可播放媒体时，必须建立内容运行时；
  与是否存在待写入值、是否已显式使用无关。
- **I2 观察 owner 与写入意图分离**：空 desired 的运行时只观察、不写入。
- **I3 attach 即发布**：运行时接管已有选中的文档时立即发布该选中的观测；
  attach 时无选中则由紧随其后的第一次选中补完一次；SPA 切换选中另一个播放器
  元素时发布该元素自己的物理值。
- **I4 观察不追随所有权，也不以呈现为门**：任何已注册元素的原生音量/静音变化
  始终以该元素自己的 target 提交页面观察，即使选中尚未迁移到它；控制所有权不因
  属性事件移动。呈现证据只服务于选择与准入。
- **I5 页面不退化**：无媒体的文档不加载重运行时；显式 release 后不重建。
- **I6 三件事互不门闩**：同步 / 使用 / 角标可见性保持既有分离。
- **I7 观察权只在证明可观察后转移**：bootstrap 只有在重运行时注册到页面播放器
  （`MediaRegistry.hasSelection`）后才停止提交原生观察；注入或 READY 握手本身
  不是证明。运行时失去最后一个选中时 bootstrap 恢复提交。交接通过
  `claimObservationOwnership` 推进共享观察 epoch，使注册表的样本压过 bootstrap
  的、且被替换的旧注册表立即过期；否则一个"已就绪但看不到播放器"的运行时会把
  文档唯一的原生事件观察者静音，下一次 Popup 读取反而成了第一个刷新快照的事件。

## 4. 方案

### 4.1 媒体出现即建立观察（background）

`runtime-loader.ts` 新增：

```ts
export const DOCUMENT_OBSERVATION_CAPABILITY = 'document-media-observation';

export async function ensureMediaObservation(tabId, documentId): Promise<void> {
  const key = runtimeKey(tabId, documentId);
  if (!initialized || retiredRuntimeKeys.has(key) || releasedMediaIntents.has(key)) return;
  await ensureContentRuntime(tabId, documentId, 'observation', DOCUMENT_OBSERVATION_CAPABILITY);
}
```

`handlers/tab-state.ts` 的 `spectra.tab.media.report` 分支，在
`recordMediaState(...)` 之后：

```ts
if (message.payload.hasMediaElement) {
  void ensureMediaObservation(tabId, sender.documentId)
    .catch((error) => swLog.warn(`[Runtime] media observation failed: ${String(error)}`));
}
```

- 依赖方向不变：`tab-state` 已从 `runtime-loader` 导入 `resumeDocumentInitialization`。
- 幂等：`ensureContentRuntime` 按 document 去重；媒体事件重复上报不会重复建图。
- 显式 release 仍由 `releasedMediaIntents` 挡住；导航/关闭仍由既有 lease 释放。
- “有媒体”的判据是 `hasMediaSurface`：`srcObject` 有轨道，或 `currentSrc`/`src` 已赋值，
  或 `readyState >= HAVE_METADATA`、`currentTime > 0`、`played.length > 0`。只有完全
  没有资源的空壳标记不算媒体。
- 触发同属边界：bootstrap 只监听真实媒体元素的生命周期事件（`loadstart`、`play`、
  `pause`、`playing`、`loadedmetadata`、`durationchange`、`emptied`、`timeupdate`）
  与 `volumechange`/`ratechange`。播放器在页面空闲后才挂载时，先挂载后赋源由
  `loadstart` 证明媒体面；先在游离元素上 `play()` 再挂载，则由挂载后继续推进的
  `timeupdate` 证明。文档级 DOM 观察属于重运行时 registry，bootstrap 不持有
  `MutationObserver`（SCTRL-001/SCTRL-018）。
- 交付必须是可确认的义务：`spectra.tab.media.report` 与 bootstrap 的页面观察只有
  收到 `ok:true` 才算落地；被重定向路由的文档身份竞态拒绝时撤回去重闩锁并按
  150/400/900/1800 ms 有界重试。后台 `ensureMediaObservation` 对同一竞态按
  120/400/1200/3000/6000/10000 ms 重试，导航/显式 release/新代际立即终止；并且
  `spectra.tab.media.report` 只有在观察 owner 真正就绪后才返回成功，失败返回可重试
  错误，等待中的消息通道让 worker 覆盖整个重试窗口。bootstrap 的 HELLO 归属握手
  按 150/400/900/1800/3000/5000 ms 重试；一次被拒绝的握手不得让文档失去观察路径。
  一次丢失的上报不得把观察 owner 拖到用户手动暂停/播放或打开 Popup 才出现。
- 角标展示不得冻结：快捷键/Popup 的乐观展示记录其基于的 control revision；同一
  document/generation 下已有更大 revision 的已准入投影时，展示立即让位给实际值并
  删除。否则一次未收敛的写入（页面重置音量、可重试 unmute 拒绝、断开的 Popup Port）
  会压住之后所有页面物理观测，直到结算/打开 Popup/5 分钟 TTL，表现为
  "点一次暂停播放或打开 Popup 才同步"。相等 revision 不算更新。
- 未选中元素的样本只能来自用户可触及的播放器：语义隐藏（`hidden` 属性或祖先、
  `display:none`、`visibility:hidden/collapse`）的预览播放器不得以其 `volumechange`
  接管活动媒体。判定不使用几何面积，因为直播路由挂载中的真实播放器可以是 0×0。

### 4.2 attach 即发布（content）

`native-media-executor.ts` 新增：

```ts
publishCurrentSelection(): void
```

- `registry.resolve(null)` 无选中则挂起 `attachPublicationPending`，不发送；
- 有选中：`primeObserved(target)` → `publishPresentationKind` →
  发送 `spectra.content.target.changed`，带
  `mediaObservation: registry.captureObservation?.()`；
- 再读取当前物理值 `['volumeBase', 'mediaMuted', 'speed', 'preservePitch', 'playing']`，
  通过 `queuePageObservation` 作为页面观测提交——否则新文档在首次原生变化或被显式
  读取前没有字段快照，角标仍会表现为“点开 Popup 才同步”。
- `selected` 事件：attach 挂起时补发一次物理值；否则仅当选中换成另一个元素
  （SPA 路由切换）时发布该元素自己的物理值。同一元素上 mediaId / sourceRevision
  变化保持 target-only，避免把冷态 page-semantic 样本重归因。
- `volumechange` 来自未被选中的元素时：以该元素自己的 target 提交 `volumeBase` /
  `mediaMuted` 页面观察，控制所有权不变。`flushPageObservations` 对这类 target
  重新读取自己的元素，而不是用控制 owner 的 delegate 读数。**直播不设呈现判据**：
  抖音直播把画面画在 canvas 上、`<video>` 可以是 0×0，首次手势前 `duration` 是
  `NaN`、`paused`、`readyState 0`，站点还可能先静音再由自己的 UI 解除——这些都
  是同一原生音量面的合法状态。语义隐藏只否决**隐藏的有限时长预览**（feed 的静音
  预览、pre-roll 空壳）。曾经的 `isPresented` 判据会让这条例在真实直播页
  永不触发，且"点一次暂停/播放就恢复"正是它的反证（`play` 把所有权移过去，
  绕过了整道门）。

在 `content/core/index.ts` 的 `bootstrapMessaging(...)` 之后调用一次，
保证消息通道就绪。重复发布由后台有序观测准入吸收，幂等。

### 4.3 worker 重启保留（background）

`runtime-restart-startup.ts` 的 `restoreDocumentOwnership` 在
“无 restore capability、无持久处理器会话”之后追加：

```ts
if (await port.resolvePersistentMediaObservation(target)) {
  durableOwner = true;
  if (runtimeWasPresent) await port.retainMediaObservationRuntime(target);
}
```

`chromePort` 实现：

- `resolvePersistentMediaObservation`：`await mediaFacts.ready()` 后读
  `mediaFacts.readMediaFact(tabId)`，要求 `documentId` 相同且 `outcome === 'found'`；
- `retainMediaObservationRuntime`：`ensureContentRuntime(..., 'observation',
  DOCUMENT_OBSERVATION_CAPABILITY)`，并校验返回的 documentId。

只保留“存活 runtime + 当前 document 有媒体事实”的情况，不复活死运行时。

### 4.4 复测回归的两个根因（2026-11-11 第二轮）

用户复测：`1. 照样要按暂停按钮 2. 新打开 douyin 就把角标显示了`。
本轮不再改观察权交接（I7 保留），而是修两个独立边界错误。

#### R1 注册即准入（content/selection）

**事实链**：
- `MediaRegistry.register()` 只挂监听、写 `byElement/byId`、`emit('registered')`，
  从不参与选择；选择只由 `play` / `pointerdown` / `loadedmetadata` 等**已经发生过的
  事件**驱动（`media-registry.ts:419-488`）。
- SPA 直播播放器在路由切换后才挂载，挂载时已经在播放；它的 `play` 发生在监听器
  注册之前，因此 `selectRecord` 永远不会为它执行。`registered` 只触发
  `primeObserved`（`native-media-executor.ts:2560`），不改变选中。
- 结果：直播 `<video>` 一直不是选中元素，它的 `volumechange` 只能走未选中分支；
  该分支带语义呈现门（`native-media-executor.ts:2578-2591`），而直播把画面画在
  canvas 上、`<video>` 常被站点隐藏（这正是 spec §4.1 记录的真实形态）。样本被静音。
- 用户点一次暂停 → `pointerdown`/`play` 才把该元素设为选中 → 选中分支**没有**呈现门，
  并且 `publishEstablishedSelection` 补发一次物理值。这就是"必须按暂停"的完整因果。

**修复**：`register()` 在挂好监听后必须执行与 `play` 相同的选择准入
（`admitBetterCandidate(true)`，受 `isSelectionProtected`/暂停钉住语义约束），
使"被发现时已在播放"的播放器无需任何用户手势就成为选中。选中变化仍由
`selected` 事件发布 target + 物理值（既有 4.2）。

**不变量 I8**：元素的生命周期事件（发现、注册）与它的播放状态同等构成选择证据；
"播放事件早于监听器"不得导致播放器永久失去选择。

#### R2 观测证人必须是元素本身（content/observation）

**事实链**：选中分支的 `handleMediaEvent` 用 `this.read()` 取样，而
`read()` 对 `volumeBase`/`mediaMuted` 优先问 `audioRuntimeDelegate`
（`native-media-executor.ts:1508-1515`）；delegate 在文档输出（capture）生效时返回
**扩展自己的 `appliedConfig`**，不是页面元素的实际值
（`audio-runtime-control-delegate.ts:118-119`）。于是原生 UI 改音量后：
`read()` 两次都返回同一个 applied 值 → 与 `this.observed` 相等 → 不产生 patch →
不提交观测。原生手势在该模式下**结构性不可见**。

**修复**：`volumechange` 的取证只以事件元素为证人——`volumeBase`/`mediaMuted`
始终从 `element` 直接读（与 `readElementVolume` 同一读取器），其余字段保持 `read()`。
delegate 只描述扩展写入的归属，不能冒充页面的物理事实。

**不变量 I9**：页面观察的证人只能是产生事件的元素；扩展自身状态（delegate /
appliedConfig / observed 缓存）不得作为页面物理值的来源。

#### R3 使用事实只能由已确认的用户手势产生（background/badge）

**事实链**：
- `config-updater.ts:31-35`：任何"非 native sync"的配置更新都置
  `userHasInteracted = true`。这是一个**否定式推断**，把程序化配置（初始化、
  `spectra.audio.runtime.configure` 内部 RPC、delegate 应用）误判为用户使用。
- 内容侧随后 `session.publish` 携带 `userInteracted: true`
  （`badge-sync.ts:44`），后台 `updateBadgeFromSession`
  → `resolveStickyUsage(tabId, true)` → `markBadgeUsed(tabId)`
  （`handlers/badge.ts:264-266, 365`），把"使用"永久写进该 tab。
- `isBadgeProjected` 因此为真，之后任何页面观察都可以画角标
  （`control-coordinator.ts:1052`）。这就是"新开 douyin 未使用就出角标"。

**修复**（唯一状态源，双向收口）：
1. 内容侧：交互是显式肯定事实。删除 `!options.isNativeSync` 推断；
   `PolicyUpdateOptions` 增加 `userOriginated?: boolean`，只有来自
   `intent.source === 'popup' | 'hotkey'` 的已确认控制/配置写入才置位
   （`audio-runtime-control-delegate.apply` 与显式用户配置入口）。
   `isNativeSync` 只保留"抑制 applyState"的原义。
2. 后台侧：用途事实只能由**已确认的显式意图**（`recordSuccessfulExtensionUse`，
   source 为 popup/hotkey）写入。`updateBadgeFromSession` 与
   `updateBadgeFromControlProjection` 只读用途（`hasBadgeUsage`），永不
   `markBadgeUsed`。会话报告是内容状态，不是使用证明。
3. tab 身份是用途的生命周期边界：`chrome.tabs.onCreated` 与 `onRemoved` 都清理
   该 tabId 的用途，消除 tabId 复用把旧用途继承给新 tab 的路径。

**不变量 I10**：角标可见性 = 该 tab 存在一次已确认的用户手势；页面观察、
会话上报、程序化配置、导航恢复都只能细化一个已可见的角标，不能创造它。

## 5. 测试

| 文件 | 用例 |
| --- | --- |
| `test/runtime-loader.spec.ts` | `ensureMediaObservation` 在未初始化/已退役/已 release 时 no-op；正常时以 `observation` 能力 ensure；文档身份竞态（`getFrame` 首次失败）时重试到成功；`hasMediaElement` handler 的接线由既有 `tab-visibility.spec.ts` 的 `recordMediaState` 用例守住 |
| `test/native-media-executor.spec.ts` | attach 时已有选中 → 发布一次带观测戳的 `target.changed`，并以 page 观测提交已有物理值；attach 无选中 → 不发，第一次选中补发一次且只补一次；SPA 切换到另一个播放器元素 → 发布该元素的物理值；同一元素身份变化 → 仍只发 target；未选中元素发生原生音量变化 → 无论是否有面积/元数据/播放历史，都以该元素 target 提交页面观察；语义隐藏的未选中预览发生音量变化 → 不提交样本 |
| `test/runtime-restart-startup.spec.ts` | 媒体事实为 `found` 且 documentId 匹配 → 保留 observation；无事实 → 既有孤儿回收用例不变 |
| `test/content-runtime-readiness.spec.ts` | 路由文档首次 HELLO 因身份竞态被拒绝 → 150 ms 后重试，缓冲的 `volumechange` 在握手落地后提交（不需要暂停/播放或 Popup）；既有 deferred HELLO、runtime takeover、owner handoff 语义不变 |
| `test/badge-volume-state.spec.ts` | 未结算的乐观展示（revision R）在页面观测以 R+1 被准入后让位给实际值（旧实现停在乐观数字）；同一 revision 的观测不得覆盖乐观展示；预览/快捷键结算语义不变 |
| `test/media-presence.spec.ts` | `srcObject` 已绑定轨道但停在 `HAVE_NOTHING`、`src`/`currentSrc` 已赋值 → 文档有可控制媒体；空壳、空流 → 没有；`readyState`/`currentTime`/`played` 的既有证据不变 |
| `test/smoke/live-target-restart.spec.ts` | 有限播放器持有控制、0×0 canvas 直播未选中时，页面改直播音量 → 角标从 80 变 37（上一版实现超时停在 80，已验证该用例能区分）；被点击过的有限播放器保持控制、页面再挂载 0×0 有限时间线出声播放器时，其音量 0.42 仍进角标；页面挂载无面积、无元数据、暂停且无播放历史的播放器后改其音量 0.31 → 角标从 80 变 31（旧判据下必然停在 80）；空文档挂载空播放器后再赋 `srcObject`（连接态触发 `loadstart`）→ 观察运行时必须由该生命周期事件加载（旧实现停在 `ready:false`），随后原生音量 0.27 进入快照 |
| `test/smoke/badge-projection.spec.ts` | 同一 tab 进入新文档后，页面原生音量 0.55 仍进角标（运行时就绪后） |
| `test/media-registry.spec.ts` | 发现时已在播放的媒体（`play` 早于监听器）注册后立即成为选中并 `emit('selected')`；暂停钉住/受保护选择不被注册抢占；已停止的媒体注册不改变选中 |
| `test/native-media-executor.spec.ts`（新增用例） | 选中元素发生 `volumechange` 时 `volumeBase`/`mediaMuted` 取自元素本身：delegate 返回相同 applied 值时仍产生 patch 并提交页面观察；未选中元素同语义 |
| `test/badge-volume-state.spec.ts`（新增用例） | 未使用 tab 收到 `userInteracted:true` 的会话上报 → 不画角标、`hasBadgeUsage` 仍为 false；已确认 popup/hotkey 意图 → 画角标并落用途；`onCreated` 后用同一 tabId 的新 tab 不继承用途 |

## 6. 文档投影

- `apps/extension-spectra/docs/architecture/runtime.md`：
  新增“媒体存在是观察运行时的加载边界”；补 attach 发布与重启保留。
- `apps/extension-spectra/docs/control/05-control-state.md`：
  同步 owner 在“有媒体”时成立，不由使用或配置门闩；使用只决定角标可见性。
- `apps/extension-spectra/docs/control/09-failure-index.md`：
  把“必须打开 Popup 才同步”的根因改为“空 patch 跳过运行时 + attach 不发布”，
  状态改为 guarded，并指向本条测试。
- 明确记录：**同源路由 `/follow` ↔ `/follow/live` 不涉及跨 origin 会话迁移**，
  避免后人再误修 tldts/site 分组。

## 7. 验收场景

1. `www.douyin.com/follow` 使用一次快捷键 → 同 tab 点进
   `/follow/live/<id>`：**不开 Popup**，角标显示直播真实音量；
   原生 UI 改音量角标随即变化；快捷键立即生效。
2. 直播页刷新：重复 1。
3. 从未使用扩展的直播 tab：角标保持隐藏（新开 douyin 即隐藏，刷新后仍隐藏），
   但快照已在同步；第一次快捷键成功并点亮角标。
4. 无媒体页面：不加载重运行时。
5. 观看直播时 worker 重启：观察继续，不需要 Popup。

## 8. 非目标

- 跨站点/跨 origin 意图迁移（不是本问题；同源切换 `rebind` 已返回 portable patch）。
- 站点控制器写穿（09 §22.3 第 3 条 declared volume adapter）仍为 open：
  本次只修“观察与接管自动成立”，不改变 >100 或站点控制器状态的边界。
- 媒体路由规则（page/capture）不变。

## 9. 风险与回退

- 风险：媒体页都会加载内容运行时。回退方式为删除 `ensureMediaObservation`
  调用；4.2/4.3 不受影响。
- 风险：`publishCurrentSelection` 与 `selected` 重复发布。后台按资源戳有序准入，
  重复样本幂等。
- 风险：媒体上报风暴。`ensureContentRuntime` 按 document 去重；若实测有成本，
  再加 per-document 已建立集合。

## 10. 门禁

`typecheck` → `lint` → `docs:check` → `verify:q` → `test:unit` →
`build:spectra`。全部通过后单提交，
subject：`fix(spectra): observe media documents without opening popup`。
