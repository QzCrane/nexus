# SPECTRA 冷页面快捷键跨越 100% 的 Capture 准入（条件让出 + 文档调用授权锁存）

状态：已批准并落地；三次真实浏览器反馈后修正为“调用授权是文档事实，不是 Capture 会话事实”
范围：`nexus/apps/extension-spectra`、`nexus/packages/contracts`（仅音量步进与授权消息）
不做：页面/站点自定义按键获得 Capture 准入、iframe 媒体 Capture、发布与公开镜像同步

## 1. 现象

从未打开过 Popup（该标签页从未获得 `activeTab`）时，在页面（如抖音直播）直接按 Alt+↑ 调到 100% 以上：

- 内容侧报 `Capture transition failed: Extension has not been invoked for the current page`，增强不启动并回滚；
- 先打开一次 Popup 再按快捷键则正常，直到该标签页导航或关闭。

## 2. 根因（第一性原理）

Chrome 硬约束：

1. `chrome.tabCapture.getMediaStreamId({ targetTabId })` 只对已获得 `activeTab` 的标签页可用；
2. `activeTab` 只由真实扩展调用产生：action 点击、上下文菜单、`commands` 快捷键、omnibox。内容脚本页面 keydown **不是** invocation；
3. Chrome 的扩展命令加速器只在“渲染进程未处理该按键”时执行。

本仓库原有行为：bootstrap 在 document_start 以 capture 阶段对所有内置和弦 `preventDefault + stopImmediatePropagation`，`volume_up` 命令因此永远不可达；冷页面的 Alt+↑ 只走 content 路径，`getMediaStreamId` 被 Chrome 拒绝。

两次失败的修正：

- “每个文档第一次让出”：让出额度会被任意一次先前按键消耗，之后回到 content 路径再次报错；
- “每次新按下都让出”：页面自身 `preventDefault` 该和弦时命令也不会执行，导致整键失效；
- “已持有 Capture 会话才不让出”：把 Capture 会话误当成 invocation 本身。从 110% 回到 100% 后 Capture 会话结束，但 Chrome 的 `activeTab` 仍然有效到文档导航为止；下一次 100→110 被错误让给命令，而命令在用户环境中不可用，表现为“Popup 调过以后 100→110 失效，110→100 正常”。

## 3. 决策

**D1（条件让出）**：Bootstrap 在 keydown 时同步判断两件事：

1. 页面主媒体（`chooseInitialMedia`）的 `volume >= 0.999`（已在原生上限，下一次 +10 必然需要 Capture）；
2. 当前文档没有已知的扩展调用授权（`ContentBootstrapState.extensionInvoked !== true`）。

两者同时成立才把这次 `Alt+↑` 交给 manifest `volume_up` 命令：命令 invocation 授予该标签页 `activeTab`，同一次按键即可启动 Capture。其余情况（上限以下、文档已授权）由 Bootstrap 独占并走 Content 路径，保留 OSD 预测与连发合并。

**调用授权是文档生命周期事实**，有三个来源，任一发生即锁存到文档导航：

- Popup 打开（action click 产生 invocation）；
- `volume_up` 等 manifest 命令送达；
- 本文件任一次成功的 Capture 启动（没有授权就不可能成功）。

Popup 打开时 Background 通过 `chrome.tabs.sendMessage(..., { documentId })` 把授权通知精确投递给该文档的 Bootstrap；命令送达时同样投递。Bootstrap 只写内存锁存，不新增请求/响应契约、不改 HELLO、不改修订号、不新增执行器。

让出时 Bootstrap 只 `stopImmediatePropagation`、不 `preventDefault`：页面 handler 无法取消该和弦，浏览器默认动作（命令加速器）仍可执行。

- `Alt+↑` 在 0–100% 区间和已授权文档中始终可用，不会因命令不可用或页面吞键整键失效。
- 从 110% 回落到 100% 后，Capture 会话即使已结束，授权仍在，下一次 `Alt+↑` 直接走 Content 路径。
- 其余四个内置和弦（Alt+←/→/↓/M）始终由 Bootstrap 独占。

**D2（硬边界）**：媒体已在 100%、文档从未被调用，且 `volume_up` 命令被用户清除（`chrome://extensions/shortcuts`）或加速器被系统/其它扩展占用时，Chrome 不会执行命令，这一次按键不改变音量；此时打开一次 Popup（授予 `activeTab` 并锁存）后即可推进。这是 Chrome 加速器通道的约束，应用层无法绕过。

**D3（音量步进自由）**：`stepEffectiveVolume` 只在**跨过 100%** 的那一步落到 100；其余情况返回 `current + delta` 的原值，不吸附任何十点网格（73→83、87→77、95→85、105→115）。

## 4. 实际变更

### 4.1 内容：`src/content/core/bootstrap.ts`

- 新增 `volumeUpNeedsCommand()`：`state.extensionInvoked === true` 时返回 false；否则 `chooseInitialMedia` 选出页面主媒体，`volume >= 0.999` 时返回 true。
- `onDefaultHotkeyKeydown`：`action === 'volume_up' && volumeUpNeedsCommand()` 时仅 `stopImmediatePropagation` 后返回，不拦截默认动作、不发布手势；其余情况维持 `acceptDefaultHotkeyKeydown`。
- `onMessage` 接受 `spectra.content.invocation.granted`，只把 `state.extensionInvoked` 置 true。
- 状态重建时沿用 `previous?.extensionInvoked`，保证同文档重新注入不丢授权。

### 4.2 共享态与授权来源

- `ContentBootstrapState` 新增可选 `extensionInvoked?: boolean`，文档生命周期内只置 true、不因 Capture 停止而复位；`markContentExtensionInvoked()` 写入同一 isolated-world 对象。
- `policy-executor/index.ts` 在每次模式应用后，`actualMode === 'capture' && phase === 'active'` 时锁存授权；`dispose()` 不再清空（会话结束不等于授权撤销）。
- `background/extension-invocation.ts` 新增 `grantContentInvocation(tabId, documentId)`：用 `chrome.tabs.sendMessage(..., { documentId })` 精确通知被调用文档。
- `control-coordinator.ts` 的 Popup identity 解析成功后立即投递授权（Popup 打开即 invocation）。
- `shortcuts.ts` 在 manifest 命令送达且前置文档即目标文档时投递授权；Content 路径不投递，因为它不证明 `activeTab`。

### 4.3 契约：`packages/contracts/src/spectra.bootstrap.ts` 与 `control-value-limits.ts`

- 新增 `spectra.content.invocation.granted` 无负载消息、`createSpectraContentInvocationGrantedMessage` 与严格 guard（仅 `protocolVersion + type` 两个键）。
- `stepEffectiveVolume` 删除十点网格与平局取整；仅保留“跨 100 落在 100”和 0/800 边界。
- `test/control-contracts.spec.ts` 同步为自由步进断言（87+10=97、105+10=115、95-10=85）；`test/spectra-protocol.spec.ts` 覆盖授权消息正反例。

### 4.4 测试

- `test/smoke/harness.ts`：`pressDefaultHotkeyFromContent` 用 ISOLATED `executeScript` 发送 OSD 手势准入的 Content 信封（`default:<正整数>`），代表命令取得 invocation 后的控制步骤；headless Input domain 不能派发浏览器保留的扩展加速器。
- `test/smoke/hotkeys.spec.ts`、`test/smoke/capture.spec.ts`：Alt+Up 的 smoke 调用使用该信封；hotkey-pending 按串行语义断言。

### 4.5 文档 owner（已同步）

- `docs/control/02-strategy-and-routes.md`：调用边界与 Alt+Up 归属（条件让出、授权锁存、页面 handler 被阻止取消）。
- `docs/control/05-control-state.md`：音量步进自由、仅在跨 100 时落到 100。
- `docs/architecture/runtime.md`：内置和弦保留规则与 Alt+Up 例外（invocation 是文档事实）。
- `docs/architecture/media-source-admission.md`：冷页面经 `volume_up` 命令取得 invocation；Popup/命令/成功 Capture 均锁存授权。
- `docs/guide/01-extension-primer.md`、`docs/guide/00-web-primer.md`：页面 Alt+↑ 的准入解释。

## 5. 验证

- `bun run build:dev` 后重载扩展并刷新页面（document_start 脚本必须换新）
- `bun test test/smoke/hotkeys.spec.ts`、`bun test test/smoke/capture.spec.ts`
- `bun run typecheck`、`bun run lint`、`bun run verify:q`、`bun run docs:check`
- SPECTRA `test:unit`

## 6. 残余边界

- 文档从未被调用、媒体已在 100%、且 `volume_up` 命令未分配或不可派发：该次 `Alt+↑` 不改变音量，`Alt+↓/M` 与 100% 以下的 `Alt+↑` 正常；打开一次 Popup 后授权锁存，后续 100→110 直接走 Content 路径。
- 页面/站点自定义音量快捷键、iframe 媒体、非活动窗口固定目标标签页仍不能冷启动 Capture。
