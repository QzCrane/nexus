# SPECTRA 功能恢复与架构闭环实施规范

## 0. 任务性质与最高目标

你正在维护 `QzCrane/nexus` 仓库中的：

```text
nexus/apps/extension-spectra
```

SPECTRA 是 Chrome Manifest V3 扩展，包含以下运行域：

```text
Background Service Worker
Popup
Options
Content Bootstrap
Content Runtime
MAIN-world site adapter
Offscreen audio host
Remote controller
Web page native media elements
```

当前任务不是局部修复若干按钮，而是恢复以下系统级结果：

1. 任意控制请求只产生一个确定的实际结果。
2. 页面、Popup、热键、远程端看到同一份已确认状态。
3. Runtime 的 READY 必须表示完整初始化和身份绑定完成。
4. 页面媒体身份、文档身份、代际和 source revision 不得漂移。
5. 读取、预测、请求、执行、ACK、持久化和 UI 投影必须严格区分。
6. 新增媒体、SPA 导航、服务工作线程重启、扩展热更新、Runtime 卸载和重新注入均不得破坏状态。
7. 一个字段或策略失败，不得吞掉其他本可独立成功的字段。
8. 所有修复必须由跨模块、跨时间顺序的自动化测试证明，不能只靠类型检查和单函数测试。

禁止把任务降级为：

```text
修几个明显报错
增加 try/catch
延长 timeout
重新执行失败请求
隐藏错误提示
修改 UI 默认值
仅让现有测试通过
```

------

# 1. 必须先建立的统一系统模型

## 1.1 五种完全不同的状态

任何实现都必须区分以下五种状态。

### A. Desired intent

用户或系统想要的结果：

```ts
speed = 1.5
effectiveVolume = 180
pip = true
compressor = true
```

Desired 不是实际值，也不能直接显示为成功。

### B. Native/runtime actual

浏览器、DOM、WebAudio graph、Capture processor 或 Chrome API 当前真实暴露的值：

```ts
element.playbackRate
element.volume
document.pictureInPictureElement
audioGraph.actualConfig
captureHost.actualConfig
chrome.tabs.get(...)
```

### C. Acknowledged actual

经过规定的事件、getter、稳定边界、处理器 ACK、generation 和 target 身份检查后，被系统接受的实际值。

### D. Authoritative snapshot

Background 已正式提交、持久化并广播的状态。

字段级权威必须是：

```ts
ControlSnapshot
```

音频处理器生命周期权威必须是：

```ts
AudioSessionSnapshot
```

二者使用独立时钟，不得相互覆盖字段含义。

架构文档已经规定 `ControlSnapshot` 是字段级实际值的唯一权威，`AudioSessionSnapshot` 只提供处理器生命周期，不能反向覆盖音量、速度、EQ 等字段。

### E. UI optimistic state

为了滑块手感临时展示的本地值。

它只能存在于发送中的短暂窗口，必须明确能够：

```text
被 ACK 确认
被新 revision 替换
在失败时回滚
```

UI optimistic state 绝不能伪装成 `ControlSnapshot`。

------

## 1.2 三种身份

### Document identity

```ts
{
  tabId: number;
  documentId: string;
  origin: string;
  generation: number;
}
```

`documentId` 是 Chrome 当前文档身份。

`generation` 是 SPECTRA 对该 tab 的逻辑状态代际。

不能只比较其中一个。

### Media identity

```ts
interface MediaTarget {
  frameId: number;
  documentId: string;
  mediaId: string;
  sourceRevision: number;
  kind: 'audio' | 'video';
}
```

同一个 `<video>` 元素更换 URL 或 `srcObject` 后，必须视为新的 source identity。

### Runtime identity

当前代码缺少足够强的显式 Runtime 身份协议。目标结构至少应为：

```ts
interface ContentRuntimeIdentity {
  tabId: number;
  documentId: string;
  origin: string;
  runtimeRevision: string;
  bootstrapRevision: string;
  generation: number;
}
```

Runtime identity 必须在扫描媒体、注册事件和发布 READY 前确定。

------

## 1.3 三种控制范围

所有能力必须显式声明作用域。

```text
tab
document/full-output
active-media
active-video
media-source
observation-only
```

禁止把以下行为混淆：

```text
对一个媒体应用设置
选择该媒体为 active target
把设置保存为 document-wide desired template
观察该媒体当前实际值
```

这四个动作必须是四个独立语义。

------

# 2. 不可违反的系统不变量

以下规则优先级高于当前实现、注释和现有测试。

## INV-001：READY 是能力屏障，不是脚本存活信号

只有完成以下全部步骤，才能发布 READY：

```text
Runtime identity 已绑定
MediaRegistry 已获得正确 documentId
NativeMediaExecutor 已获得正确 tabId/documentId
消息处理器已注册
媒体发现已完成
initial actual sync 已完成
配置恢复已完成或明确进入 degraded 状态
PolicyExecutor 初次 applyState 已完成
Capture/WebAudio 的最终状态已得到 ACK
Runtime 尚未被 dispose
当前 document 仍然有效
```

任何一个未完成，都不能发布普通 READY。

------

## INV-002：同一 document 同一时刻只能有一个可写 Runtime

动态重注入、热更新和 lease handoff 期间允许旧 Runtime 进入 disposing，但不能同时存在两个写入者。

必须有明确状态机：

```text
ABSENT
→ LOADING
→ INITIALIZING
→ READY
→ DISPOSING
→ ABSENT
```

错误状态不能冒充 READY：

```text
DEGRADED
FAILED
STALE
INVALIDATED
```

------

## INV-003：读取不能隐式改变权威状态，除非明确执行 observation commit

允许两种设计：

### 纯读取

返回：

```ts
ControlViewProjection
```

不能改变 revision，也不能冒充 `ControlSnapshot`。

### 权威观察提交

执行：

```text
read actual
→ compare
→ revision + 1
→ persist
→ publish
```

当前“返回内容已变化的 `ControlSnapshot`，但不增加 revision、不持久化”属于禁止状态。

------

## INV-004：成功必须意味着真实应用成功

以下任何情况都不能返回 success：

```text
使用默认值猜测当前 actual
setter 没有事件/getter ACK
处理器只接受了请求但没有实际配置
PiP DOM 发生变化但 Snapshot 提交失败
storage 保存成功但 Runtime 未应用
Runtime READY 但初始化仍在运行
```

------

## INV-005：错误不能跨字段扩散

除非产品明确要求事务原子性，否则：

```text
speed 失败
```

不能阻止：

```text
EQ
compressor
pan
delay
tab mute
```

继续执行。

字段之间必须有明确依赖图，而不是由 Popup 中的发送顺序决定成败。

------

## INV-006：恢复设置不能改变用户选择

```text
restore/replay desired fields onto target B
```

不得推导为：

```text
activeMedia = B
activeVideo = B
```

选择变化只能来源于明确选择证据：

```text
用户指针交互
真实页面控制交互
播放优先级变化
显式 target selection intent
fullscreen/PiP 的浏览器实际 owner
产品定义的确定性评分规则
```

------

## INV-007：扩展自己产生的 DOM 事件不能伪装成页面用户行为

pending write、owned seek、restore replay 和扩展控制产生的事件必须在 active-target 选择之前完成归因。

不能先选择 target，再在后续 Executor 阶段发现事件是自己产生的。

------

## INV-008：运行时缓存不能比 Runtime 本身更权威

Background 缓存 READY 只是一种优化。

出现以下任一情况时必须失效：

```text
Content 报告 disposed
status probe 返回 not ready
请求返回 content_runtime_not_loaded
documentId 改变
runtimeRevision 改变
extension context invalidated
release 结果不确定
READY 后健康检查失败
```

------

# 3. 当前已确认的根因缺陷

## BUG-001：初始化尚未完成就发布 READY

`applyInitialState()` 调用 `policyExecutor.applyState()` 时没有 `await`；配置加载分支同样不等待。外层 `try/catch` 因此捕获不到异步拒绝。

随后 `initSpectra()` 直接设置本地 ready 并向 Background 发送 `spectra.content.runtime.ready`。

### 必须修改

所有初始策略应用必须：

```ts
await policyExecutor.applyState();
```

`applyInitialState()` 应返回结构化结果：

```ts
type RuntimeInitializationResult =
  | {
      status: 'ready';
      actualMode: SpectraAudioMode;
      phase: AudioSessionPhase;
    }
  | {
      status: 'degraded';
      error: RuntimeInitializationError;
      usableCapabilities: readonly ControlCapability[];
    }
  | {
      status: 'failed';
      error: RuntimeInitializationError;
    };
```

`initSpectra()` 必须根据结果决定发送：

```text
runtime.ready
runtime.degraded
runtime.failed
```

不能在 catch 后继续正常 READY。

### 必须新增测试

```text
applyState promise 未 resolve
=> Background 不得收到 READY

applyState reject
=> Background 不得缓存 READY

Capture 启动中
=> READY 必须等待最终 active/error ACK

Runtime 在初始化过程中被 dispose
=> 不得发布任何 READY
```

------

## BUG-002：Observation-only Runtime 没有获得身份

`MediaRegistry` 初始 `documentId` 是空字符串，并在构造函数中立即扫描媒体。

`NativeMediaExecutor` 初始 `tabId` 是 `null`，只有 `bindRequestContext()` 才设置身份。

但该绑定目前只发生在收到重 Runtime 的 `actual.read` 或 `intent.execute` 时。

Popup 的初次实际读取可以由轻量 Bootstrap 完成，不会触发重 Runtime 绑定。

Popup 随后只调用 ensure observation lease，而 loader 只注入并等待 READY，没有向 Runtime 提供完整身份。

### 直接后果

`NativeMediaExecutor.handleMediaEvent()` 在 `tabId === null` 时直接退出。

因此仅打开 Popup 后：

```text
页面音量变化
页面速度变化
播放/暂停变化
seek
PiP/fullscreen 变化
target selection
```

可能全部无法同步。

### 目标修复

不要继续依赖“第一次业务请求顺便绑定身份”。

新增初始化消息：

```ts
interface ContentRuntimeInitializePayload {
  identity: {
    tabId: number;
    documentId: string;
    origin: string;
    generation: number;
  };
  runtimeRevision: string;
  bootstrapRevision: string;
}
```

建议启动顺序：

```text
Background resolve current document identity
→ inject content-runtime.js
→ send runtime.initialize(identity)
→ Runtime 创建 MediaRegistry(identity.documentId)
→ Runtime 创建 NativeMediaExecutor(tabId, documentId)
→ 扫描媒体
→ initial actual sync
→ apply config
→ publish READY
```

构造 API 应改为：

```ts
new MediaRegistry({
  documentId,
  frameId: 0,
});

new NativeMediaExecutor({
  registry,
  tabId,
  documentId,
});
```

不允许创建无身份 Registry。

### 必须新增测试

```text
只申请 observation lease
没有任何普通 intent
页面第一次 volumechange
=> Snapshot 正式提交

只申请站点热键 lease
第一次 play_pause
=> target 带真实 documentId

Runtime 扫描页面已有 video
=> 所有 target 从产生时就有 documentId
```

------

## BUG-003：`snapshot.get` 返回伪权威对象

`getControlViewSnapshot()` 会将页面实时值合入返回对象，但不持久化、不广播、不增加 revision。

现有测试还明确要求该读取零写入、零事件。

Popup 却把它作为：

```text
controlSnapshot
controlRevision
config actual
```

使用。

### 修复方案

优先采用方案 A：

```text
Popup 请求 snapshot
→ Background 读取 authority
→ live actual read
→ 若 live 与 authority 不同
   → 作为 source='page' observation commit
   → revision + 1
   → persist
   → publish
→ 返回正式权威 Snapshot
```

这样 Popup 永远只接收正式 Snapshot。

备选方案 B：

```ts
interface ControlViewProjection {
  authority: ControlSnapshot | null;
  live: {
    target: MediaTarget | null;
    patch: ControlPatch;
    readAt: number;
  };
}
```

但 UI 写入不能以 live projection 的 revision 为基础。

### 禁止

```text
改变 fields
保留旧 revision
继续使用 ControlSnapshot 类型
```

### 必须新增测试

```text
authority volume=100 revision=5
页面实际 volume=50
snapshot.get 返回 50
用户随后只改 speed
=> 新 revision 中 volume 必须仍为 50
```

------

## BUG-004：restore replay 抢占 active target

Executor 会保存 document-wide `desiredMedia`，并在任意媒体 `registered` 或 `loadedmetadata` 时调用 `replayDesired(target)`。

`replayDesired()` 使用明确 target 发送 restore intent。

Background 当前会根据 ACK target 和能力作用域更新 `activeMedia/activeVideo`。

### 目标语义

为所有 intent 增加明确 target projection policy：

```ts
type TargetProjectionPolicy =
  | 'select'
  | 'preserve'
  | 'clear-if-owner-released';
```

普通用户控制：

```ts
selectionPolicy: 'select'
```

restore replay：

```ts
selectionPolicy: 'preserve'
```

page observation：

```ts
selectionPolicy: 'select'
```

但必须证明该 observation 是真实页面交互，而不是扩展-owned event。

### replay 范围也必须收紧

Document-wide desired native fields 不得无条件应用到所有新媒体。

至少区分：

```ts
type DesiredReplayScope =
  | 'current-active-target'
  | 'same-media-id'
  | 'same-source-owner'
  | 'all-media-explicit';
```

默认只能是：

```text
current-active-target
```

### 必须新增测试

```text
主视频 A active
新增隐藏视频 B
B loadedmetadata
=> activeMedia 仍为 A

主视频 A activeVideo
新增广告 audio C
=> activeMedia/activeVideo 不得被 C 无条件覆盖

restore 设置到 B
=> B 获得设置，但 selection 不变
```

------

## BUG-005：扩展产生的事件会错误影响媒体选择

Registry 当前在收到 trusted `volumechange/ratechange/seeked` 时，先更新 interaction 和选择 target，再把事件交给 Executor。

Executor 之后才检查 pending write 和 owned seek。

### 必须重构事件归因

Registry 不得直接根据这些事件选择 target。

建议引入：

```ts
interface ClassifiedMediaEvent {
  target: MediaTarget;
  type: MediaRegistryEvent;
  origin:
    | 'extension-write'
    | 'extension-restore'
    | 'extension-seek'
    | 'page-interaction'
    | 'page-script'
    | 'browser-lifecycle'
    | 'unknown';
  actualPatch: ControlPatch;
}
```

处理顺序：

```text
Registry 捕获原始事件
→ Executor 关联 pending/ownership
→ 生成 ClassifiedMediaEvent
→ SelectionPolicy 决定是否切换 target
→ Coordinator 决定是否提交 observation
```

至少：

```text
extension-write
extension-restore
extension-seek
```

不得产生 active selection。

### 必须新增测试

```text
A active
扩展向非活动 B 写 speed
B 产生 trusted ratechange
=> active 仍为 A

marker seek 产生 seeked
=> 不得被解释为用户选择变化
```

------

## BUG-006：effective-volume 使用伪造 actual

Cold snapshot 中读取失败后，当前代码吞掉错误，并将：

```text
volumeBase = 100
boost = 1
```

作为实际基线。

随后还可能基于该默认值返回 no-op success。

### 新规则

#### Delta 操作

```text
必须先获得 confirmed actual
读取失败 => 返回 actual-unavailable
不得猜测
```

#### Absolute set

允许不依赖原值直接执行，但：

```text
必须实际写入
必须 readback
不得基于 guessed current 判定 no-op
```

#### No-op 判定

只有满足以下条件才能 no-op：

```text
authority 中存在已确认 actual
document/source identity 匹配
actual 与 requested 相同
没有正在进行的 conflicting transition
```

### 建议错误类型

```ts
{
  code: 'actual-unavailable';
  retryable: true;
  message: string;
}
```

### 必须新增测试

```text
实际 volume=20
cold read 失败
delta -10
=> 不执行写入，不得得到 90

实际 volume=20
cold read 失败
set 100
=> 必须尝试写入并以 readback 决定成功

read 失败
requested=100
=> 不得因为 fallback=100 返回 no-op success
```

------

## BUG-007：Popup 合并队列会吞掉独立字段

Popup 在发送前清空 pending 数据，再顺序执行 effective volume、target patch 和 full patch。任一前置请求失败，后续请求不会执行，未发送字段也不会重新入队。

### 必须改成字段计划器

先把用户变化编译成独立 execution units：

```ts
interface PopupControlUnit {
  id: string;
  fields: readonly ControlField[];
  dependencyGroup: string;
  coverage: ControlCoverage;
  request: ControlRequest;
}
```

例如：

```text
effective-volume
native-media-fields
full-output-DSP-fields
tab-fields
video-fields
```

然后按依赖执行：

```ts
const results = await Promise.allSettled(independentUnits);
```

只有真正依赖另一个结果的 unit 才顺序等待。

### 失败处理

每个 unit 必须保存：

```text
optimisticBefore
desired
requestId
result
actual
error
```

失败时：

```text
只回滚该 unit 管辖字段
不回滚已经成功的字段
不吞掉尚未发送的独立 unit
```

### 必须新增测试

```text
speed 失败 + EQ 成功
=> EQ 仍然发送并保留

volume 失败 + compressor 成功
=> compressor 不丢失

target group 失败
=> full-output group 仍执行

两个 unit 都失败
=> UI 分别显示字段错误
```

------

## BUG-008：PiP 缺少端到端结果协议

当前 Popup 通过 isolated-world script dispatch 一个事件，然后仅等待原生 PiP DOM event。

桥内部调用 `submitTrustedActivationControl()`，但会吞掉错误。

`submitTrustedActivationControl()` 实际包含两个阶段：

```text
浏览器原生 PiP 操作
Background Snapshot observation 提交
```

现在 Popup 只能知道第一阶段的 DOM event，不能知道第二阶段是否成功。

### 新 PiP 事务

```ts
interface TrustedActivationRequest {
  requestId: string;
  operation: 'pip-toggle';
  expectedDocumentId: string;
  expectedRuntimeRevision: string;
}

type TrustedActivationResult =
  | {
      ok: true;
      requestId: string;
      nativeApplied: true;
      snapshotCommitted: true;
      actual: boolean;
      target: MediaTarget;
      snapshotRevision: number;
    }
  | {
      ok: false;
      requestId: string;
      nativeApplied: boolean;
      snapshotCommitted: boolean;
      actual?: boolean;
      error: ControlError;
    };
```

### 处理顺序

```text
Popup click
→ 确认 bridge READY 和 runtime identity
→ 同步进入 trusted activation handler
→ 调原生 PiP API
→ 等 enter/leave + getter ACK
→ 提交 page observation
→ 等 Background 正式 Snapshot commit
→ 返回结构化结果
```

### UI 行为

```text
nativeApplied=false
=> 显示浏览器/媒体能力错误

nativeApplied=true, snapshotCommitted=false
=> 显示“PiP 已切换，但状态同步失败”
=> 立即触发权威 resync

全部成功
=> 使用正式 Snapshot 更新按钮
```

### 必须覆盖

```text
Runtime 未加载
桥未注册
无活动视频
activation expired
NotAllowedError
NotSupportedError
native 成功但 Snapshot 失败
重复快速点击
document 在操作中导航
```

------

## BUG-009：READY 缓存可能复用死亡 Runtime

Content Runtime 自行 dispose 时只清除本地状态，未明确通知 Background。

Background `ensureReadyDocument()` 发现同 revision 缓存后直接返回，不进行 status probe。

### 必须增加

```text
spectra.content.runtime.disposed
```

Payload：

```ts
{
  runtimeRevision: string;
  reason:
    | 'lease-release'
    | 'extension-update'
    | 'context-invalidated'
    | 'pagehide'
    | 'initialization-failed'
    | 'replaced';
}
```

Background 收到后：

```text
校验 sender tab/document
删除 ready cache
删除 loading cache
处理 waiter
保留或清理 lease，按 reason 决定
```

客户端遇到：

```text
content_runtime_not_loaded
runtime_revision_mismatch
```

时不能普通 ensure 后继续复用同缓存，而应：

```text
invalidate cache
status probe
必要时重新注入
```

------

## BUG-010：Legacy compatibility 可以破坏 v2 权威

Legacy adapter 可以直接覆盖 Popup config，且没有完整的 document/generation/revision 防护。

### 处理原则

优先删除兼容层。

确需保留时，只有满足全部条件才可接受：

```text
当前没有匹配的 v2 ControlSnapshot
legacy 消息 sender document 与当前 document 一致
legacy generation 不旧
消息只填充缺失字段
不得覆盖已存在的 v2 actual
```

兼容层必须有明确删除版本和测试。

------

# 4. 目标 Runtime 初始化协议

## 4.1 Background 状态结构

```ts
interface RuntimeRecord {
  identity: ContentRuntimeIdentity;
  state:
    | 'loading'
    | 'initializing'
    | 'ready'
    | 'degraded'
    | 'disposing';
  capabilities: ReadonlySet<ControlCapability>;
  leases: Map<string, RuntimeLease>;
  lastHealthCheckAt: number;
  initializationError?: RuntimeInitializationError;
}
```

不要继续用多个彼此松散的：

```text
readyDocuments
loadingDocuments
disposingDocuments
waiters
leases
disposeTimers
```

作为没有统一状态机的事实来源。

这些集合可以作为实现细节，但必须被一个 `RuntimeRecord` 聚合约束。

------

## 4.2 初始化时序

```text
ensureContentRuntime
  → resolve current document identity
  → acquire lease
  → inspect RuntimeRecord
  → status probe existing runtime
  → inject content-runtime.js if absent
  → send runtime.initialize(identity)
  → Runtime binds identity
  → Runtime registers listeners
  → Runtime scans media
  → Runtime performs authoritative initial actual read
  → Runtime loads settings
  → Runtime awaits initial policy application
  → Runtime publishes ready/degraded/failed
  → Background validates sender/document/revision
  → Background commits RuntimeRecord
  → resolve all waiters
```

## 4.3 READY 响应

```ts
interface ContentRuntimeReadyResult {
  identity: ContentRuntimeIdentity;
  state: 'ready' | 'degraded';
  capabilities: readonly ControlCapability[];
  initializedAt: number;
  initialControlSnapshotRevision: number;
  audioSessionGeneration: number;
  error?: RuntimeInitializationError;
}
```

调用者必须根据 capability 判断请求能否执行，不能只看 `ready: true`。

------

# 5. ControlSnapshot 的正确事务模型

## 5.1 所有提交必须经过一个串行入口

```ts
enqueueControlTransaction(tabId, transaction)
```

事务必须包含：

```ts
interface ControlTransaction {
  transactionId: string;
  source: ControlSource;
  expectedIdentity: DocumentIdentity;
  expectedBaseRevision?: number;
  selectionPolicy: TargetProjectionPolicy;
  units: readonly ControlExecutionUnit[];
}
```

## 5.2 事务步骤

```text
读取当前 authority
验证 document/generation/baseRevision
解析 actual baseline
编译独立 execution units
执行允许并行的 units
验证每个 ACK
执行必要 compensation
生成 changedFields
应用 selectionPolicy
生成 revision + 1
持久化
发布 Snapshot
更新 badge/remote/UI
重新计算 Runtime ownership
```

## 5.3 不能提交空 revision

以下 operation 不应无意义增加 control revision：

```text
open options
open URL
open Popup
纯 UI operation
没有字段变化的 no-op
```

除非 revision 的定义明确包含非媒体控制事件。

当前 Background operation 会创建新 revision 即使字段为空，应重新审查该语义。

推荐将其拆为：

```text
ControlSnapshot revision
UIOperationResult operation sequence
```

不要让打开设置页污染媒体字段 revision。

------

# 6. MediaRegistry 与 active target 的目标设计

## 6.1 Registry 只负责身份和候选事实

Registry 可以记录：

```text
registered
connected
source revision
playing
visible area
last trusted pointer interaction
fullscreen owner
PiP owner
last playback start
```

Registry 不应直接决定所有 active selection。

## 6.2 SelectionEngine

新增纯函数：

```ts
function selectActiveTarget(
  previous: ActiveTargetState,
  candidates: readonly MediaCandidate[],
  evidence: SelectionEvidence,
): ActiveTargetState;
```

排序输入必须明确：

```text
显式用户选择
PiP/fullscreen owner
真实页面控制交互
当前播放
最近播放
可见面积
稳定 registration order
```

restore replay、extension-owned write 不得作为选择证据。

## 6.3 activeMedia 与 activeVideo 始终独立

```text
activeMedia
activeVideo
```

不能因为某个 audio 正在播放就清除 activeVideo。

不能因为对 video 应用 rotate 就把它变成 activeMedia，除非能力作用域要求。

------

# 7. 音频策略执行串行化

当前 `executeMode()` 使用全局 `executionRun` 取消陈旧 continuation，能够缓解部分竞态，但它不是完整事务队列。

## 目标设计

每个 Runtime 使用实例级队列：

```ts
class PolicyExecutionQueue {
  private tail: Promise<void>;
  private generation: number;

  submit(request: PolicyExecutionRequest): Promise<PolicyExecutionResult>;
}
```

每次请求必须捕获不可变快照：

```ts
{
  config;
  documentIdentity;
  requestedGeneration;
  reason;
}
```

不能在执行中不断读取可能被其他请求修改的共享 `state.config`。

## 关键规则

```text
同一 document 的 Policy transition 串行
新的 desired 可取消旧 transition 的提交权
旧 transition 可以完成清理，但不能提交最终状态
Capture/WebAudio handoff 必须有明确 candidate/stable owner
READY 等待 initialization transition 完成
dispose 等待或取消所有 transition
```

------

# 8. 分阶段实施计划

## 阶段 0：建立可复现基线

不要立即修改代码。

先完成：

```text
列出今天所有 SPECTRA 相关提交
确定重构前最后一个稳定 commit
生成 changed-file inventory
按 Background/Content/Popup/Contracts/Tests 分类
记录当前 package scripts
运行当前全部已有测试
记录失败和不稳定项
```

创建回归说明文档：

```text
docs/regression-recovery-2026-07-18.md
```

内容必须列出：

```text
缺陷
复现步骤
预期
实际
根因
修复 commit
测试文件
最终状态
```

------

## 阶段 1：Runtime identity 与 READY

优先修改：

```text
src/background/runtime-loader.ts
src/content/core/index.ts
src/content/core/bootstrap.ts
src/shared/content-runtime.ts
packages/contracts/src/spectra.content-runtime.ts
```

完成标准：

```text
不存在无身份 Runtime
不存在无身份 MediaTarget
READY 晚于 initial policy apply
初始化失败不会 READY
observation-only 加载可立即同步页面事件
```

------

## 阶段 2：Snapshot authority

优先修改：

```text
src/background/control-coordinator.ts
src/popup/card/init.ts
src/popup/card/messaging.ts
packages/contracts/src/control.contracts.ts
```

完成标准：

```text
Popup 不再接收伪 Snapshot
live read 与 authority 分离或正式提交
任何字段变化均有单调 revision
无关操作不会回滚 live actual
```

------

## 阶段 3：媒体选择与 replay

优先修改：

```text
src/content/core/media-registry.ts
src/content/logic/native-media-executor.ts
src/background/control-coordinator.ts
```

完成标准：

```text
restore replay 不改变选择
扩展-owned events 不改变选择
隐藏媒体不抢 target
页面 override 后旧 desired 不复活
```

------

## 阶段 4：PiP 与 trusted activation

优先修改：

```text
src/popup/card/media-events.ts
src/content/input/trusted-activation-bridge.ts
src/content/input/hotkey-helpers.ts
src/shared/trusted-activation.ts
```

完成标准：

```text
一次点击端到端返回结构化结果
不能只靠 2 秒 timeout
native success 与 Snapshot commit 分开报告
Runtime 未 ready 时按钮不可执行或先完成同步 ensure
```

------

## 阶段 5：Popup transaction manager

优先修改：

```text
src/popup/card/state.ts
src/popup/card/events.ts
src/popup/side-panel/*
```

完成标准：

```text
一个字段失败不吞其他字段
字段级 optimistic rollback
明确 dependency graph
所有 pending unit 最终 settled
pagehide drain 不丢请求
```

------

## 阶段 6：Runtime cache 与更新

优先修改：

```text
src/background/runtime-loader.ts
src/content/core/index.ts
src/content/core/extension-context.ts
src/background/upgrade-manager.ts
```

完成标准：

```text
Content dispose 会使 Background cache 失效
content_runtime_not_loaded 强制重新探测
扩展热更新无死亡 Runtime 复用
lost release ACK 可安全恢复
```

------

## 阶段 7：兼容层清理

审查：

```text
Actions.UI_SYNC
legacy-message-adapter.ts
旧 capture envelope
旧 content entry
旧 manifest 文件名
旧 remote protocol
```

每一个兼容层必须有：

```text
支持的旧版本
为什么仍需要
何时删除
对 v2 authority 的隔离方式
测试
```

没有明确消费者的兼容层直接删除。

------

# 9. 测试体系要求

## 9.1 单元测试不足

现有测试大量证明：

```text
某函数在孤立输入下返回什么
```

但缺少：

```text
跨 Runtime
跨请求
跨 revision
跨 document
跨 lease
跨异步完成顺序
```

的系统不变量。

必须增加 state-machine 和 sequence tests。

------

## 9.2 核心时序测试矩阵

| 场景                         | 必须验证                                                    |
| ---------------------------- | ----------------------------------------------------------- |
| Popup 首次打开               | Bootstrap live read、Runtime ensure、identity bind 顺序正确 |
| Runtime 慢初始化             | READY 不提前                                                |
| Runtime 初始化失败           | 不产生正常 READY                                            |
| 页面在 Popup 关闭时改音量    | 重开后 authority 正确                                       |
| Snapshot view 后改无关字段   | 其他字段不回滚                                              |
| 新广告视频插入               | 不抢 active target                                          |
| Restore 写非活动媒体         | 不改变 selection                                            |
| Extension-owned ratechange   | 不当成页面选择                                              |
| Cold volume read 失败        | 不使用默认值计算 delta                                      |
| 多字段同时操作               | 一个失败不吞其他字段                                        |
| PiP native 成功、commit 失败 | UI 明确报告部分成功                                         |
| Service worker restart       | 可恢复 live Runtime 和 source leases                        |
| Runtime 自行 dispose         | Background cache 失效                                       |
| SPA same-document navigation | generation 更新且身份不丢                                   |
| Full navigation              | 旧 ACK 无法提交                                             |
| Extension update             | 旧 Runtime 退出，新 Runtime 唯一接管                        |

------

## 9.3 随机状态机测试

构造模型状态：

```ts
interface ModelState {
  document: DocumentIdentity;
  runtime: RuntimeLifecycleState;
  authority: ControlSnapshot | null;
  liveMedia: MediaModel[];
  leases: RuntimeLease[];
  popup: PopupModel;
}
```

随机生成操作：

```text
navigate
same-document navigate
insert media
remove media
change source
play
pause
change volume
change speed
open Popup
close Popup
submit control
start Capture
stop Capture
dispose Runtime
restart Background
update extension
```

每一步检查不变量。

重点检查：

```text
Snapshot document 与 current document 一致
revision 单调
active target 指向存在且同 document/source 的媒体
READY Runtime 必须实际存在
没有两个写 Runtime
actual 不能来自 fallback
成功请求最终可观察
```

------

## 9.4 Chrome 集成测试

至少覆盖真实浏览器行为：

```text
video.volume setter 产生的 event.isTrusted 行为
playbackRate event
PiP activation
fullscreen
MutationObserver media insertion
src/source/srcObject replacement
requestVideoFrameCallback
hidden/background tab rAF fallback
service-worker suspend/restart
extension reload
```

Fake EventTarget 不能代替这些浏览器语义。

------

# 10. 对 AI 的代码执行纪律

## 10.1 修改前

每个文件修改前必须回答：

```text
该文件拥有哪个状态？
它是 authority、projection、transport 还是 executor？
谁调用它？
它向谁发送消息？
它在哪个 runtime domain？
它能否跨 document 生命周期存活？
它的失败由谁处理？
```

## 10.2 禁止并行修改同一权威链

这些模块高度耦合，不允许多个代理同时独立修改：

```text
runtime-loader.ts
content/core/index.ts
control-coordinator.ts
control contracts
```

可以并行的工作：

```text
测试补充
文档更新
Popup UI 错误展示
静态检查
独立 compatibility inventory
```

但必须由一个主代理统一合并状态模型。

## 10.3 每次提交要求

每个 commit 只解决一个闭环：

```text
契约
实现
测试
文档
```

禁止：

```text
一个 commit 同时重写 Runtime、Popup、远程端、构建系统
只改实现不改测试
只加测试但保留错误语义
用大范围 rename 混淆行为 diff
```

建议 commit 序列：

```text
fix(spectra): bind content runtime identity before discovery
fix(spectra): await initial policy state before ready
fix(spectra): commit live snapshot observations authoritatively
fix(spectra): preserve target selection during desired replay
fix(spectra): classify extension-owned media events
fix(spectra): reject effective-volume deltas without actual baseline
fix(spectra): isolate popup control unit failures
fix(spectra): return end-to-end trusted PiP acknowledgements
fix(spectra): invalidate dead runtime cache entries
test(spectra): add runtime and control sequence regressions
```

------

# 11. 错误和可观察性规范

所有关键失败都必须结构化。

```ts
interface ControlError {
  code:
    | 'runtime-not-ready'
    | 'runtime-initialization-failed'
    | 'runtime-identity-mismatch'
    | 'actual-unavailable'
    | 'stale-document'
    | 'stale-media-source'
    | 'readback-mismatch'
    | 'user-activation-required'
    | 'capability-unavailable'
    | 'snapshot-commit-failed'
    | 'transaction-partially-applied';
  message: string;
  retryable: boolean;
  phase?: string;
  transactionId?: string;
  documentId?: string;
  mediaId?: string;
}
```

禁止把不同错误统一降级为：

```text
control_failed
timeout
something went wrong
```

日志必须包含：

```text
transactionId
requestId
tabId
documentId
generation
baseRevision
runtimeRevision
target mediaId/sourceRevision
phase
```

生产日志不能泄露敏感远程凭据或页面内容。

------

# 12. 性能优化边界

优化必须服从正确性。

允许：

```text
避免重复 status probe
合并独立只读
20Hz latest-value coalescing
取消过时 UI render
延迟加载视频增强模块
空闲后释放 Runtime
```

禁止：

```text
为了避免 storage write 而返回伪 Snapshot
为了减少消息而跳过身份绑定
为了快速 READY 而不等待 applyState
为了减少 Runtime 存活而丢失页面事件
为了减少代码量而合并 authority 和 projection
使用默认值代替失败的实际读取
```

性能指标必须至少包含：

```text
首次 Popup 可交互时间
Runtime ensure 时间
initialization 完成时间
首次 control ACK 时间
每次 slider gesture IPC 数
每次操作 storage write 数
空闲页面 Runtime 存活数量
Background restart 后恢复耗时
```

------

# 13. 完成定义

只有满足全部条件才能宣布完成。

## 架构完成

```text
Runtime identity 显式存在
READY 有真实状态机
ControlSnapshot 只有一个提交入口
View projection 不再冒充 Snapshot
Selection 与 replay 分离
Event ownership 在 selection 前判断
```

## 功能完成

```text
网页改变音量/速度立即同步
Popup 快速首次操作稳定
PiP 一次点击有确定结果
隐藏媒体不会抢控制
多字段操作不会互相吞掉
Capture/WebAudio 初始化无竞态
热更新不会复用死亡 Runtime
```

## 验证完成

```text
新增所有回归测试通过
旧测试通过
development Chrome integration 通过
production ZIP Chrome integration 通过
类型检查通过
lint/format 通过
architecture checker 通过
重复执行无 flaky
```

## 文档完成

以下文档必须与实现同步：

```text
control-architecture.md
protocols.md
regression-recovery-2026-07-18.md
runtime lifecycle diagram
control transaction diagram
test coverage matrix
```

------

# 14. 最终交付报告格式

最终 AI 必须提交：

## A. 根因清单

每项包含：

```text
现象
根因
触发条件
影响范围
修复位置
测试证据
```

## B. 文件变更表

```text
路径
职责变化
新增不变量
删除旧行为
```

## C. 协议变化

列出：

```text
新增消息
删除消息
payload
response
版本迁移
兼容策略
```

## D. 测试结果

不得只写“全部通过”。

必须给出：

```text
测试命令
文件数
测试数
断言数
Chrome 场景数
development/production 结果
flaky 重跑结果
```

## E. 剩余风险

必须明确区分：

```text
已修复
已验证
只做静态推导
需要真实网站验证
浏览器平台限制
```

------

# 15. 最终执行命令

你必须自主持续执行以下闭环，不得停留在建议：

```text
发现
→ 建模
→ 复现
→ 写失败测试
→ 修改契约
→ 修改实现
→ 跑局部测试
→ 跑完整测试
→ 跑真实 Chrome
→ 对抗检查
→ 回退重算
→ 更新文档
→ 再跑完整发布门
```

发现新的决定性根因时，必须返回上游重建模型。

不得为了维持已经完成的修改而忽略反证。

不得用已有 345 个测试、发布报告或 architecture gate 证明没有功能回归；这些证据只能证明它们覆盖到的性质。

最终目标不是“测试变绿”，而是：

```text
所有控制表面、所有 Runtime 生命周期和所有媒体身份路径
在任意合法事件顺序下
都收敛到同一个可验证的实际状态。
```