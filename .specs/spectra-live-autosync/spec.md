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
- **I4 观察不追随所有权**：呈现中元素的原生音量/静音变化始终以该元素自己的
  target 提交页面观察，即使选中尚未迁移到它；隐藏预览不观察，控制所有权不因
  属性事件移动。
- **I5 页面不退化**：无媒体的文档不加载重运行时；显式 release 后不重建。
- **I6 三件事互不门闩**：同步 / 使用 / 角标可见性保持既有分离。

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
- `volumechange` 来自未被选中的元素时：若 `registry.isPresented(target)` 为真，
  以该元素自己的 target 提交 `volumeBase` / `mediaMuted` 页面观察；隐藏预览不提交，
  控制所有权不变。`flushPageObservations` 对这类 target 重新读取自己的元素，而不是
  用控制 owner 的 delegate 读数。

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

## 5. 测试

| 文件 | 用例 |
| --- | --- |
| `test/runtime-loader.spec.ts` | `ensureMediaObservation` 在未初始化/已退役/已 release 时 no-op；正常时以 `observation` 能力 ensure；`hasMediaElement` handler 的接线由既有 `tab-visibility.spec.ts` 的 `recordMediaState` 用例守住 |
| `test/native-media-executor.spec.ts` | attach 时已有选中 → 发布一次带观测戳的 `target.changed`，并以 page 观测提交已有物理值；attach 无选中 → 不发，第一次选中补发一次且只补一次；SPA 切换到另一个播放器元素 → 发布该元素的物理值；同一元素身份变化 → 仍只发 target；未选中但呈现中的元素发生原生音量变化 → 以该元素 target 提交页面观察，隐藏预览不提交 |
| `test/runtime-restart-startup.spec.ts` | 媒体事实为 `found` 且 documentId 匹配 → 保留 observation；无事实 → 既有孤儿回收用例不变 |

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
3. 从未使用扩展的直播 tab：角标保持隐藏，但快照已在同步；
   第一次快捷键成功并点亮角标。
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
