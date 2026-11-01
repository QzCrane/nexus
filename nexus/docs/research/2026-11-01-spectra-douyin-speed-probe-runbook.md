# 抖音倍速实机探测 — 运行手册（EPR-028 执行件）

- **日期**：2026-11-01
- **状态**：可执行。脚本与夹具已通过自证（19/19），**尚未在真实抖音标签页运行**。
- **上游**：`proposals/2026-11-01-spectra-douyin-speed-official-adapter.md` §8
- **前提报告**：`research/2026-11-01-spectra-douyin-speed-sync-root-cause.md`
- **产物**：
  - `apps/extension-spectra/tools/probes/douyin-speed-probe.js`（零依赖，粘贴即用）
  - `apps/extension-spectra/tools/probes/fixtures/douyin-like-player.html`（仿抖音夹具）
  - `apps/extension-spectra/tools/probes/verify-probe.ts`（自证脚本）

> 本手册只做**取证**，不做修复。探测结果回填注册表条目后，才进入实现阶段。

---

## 0. 为什么需要实机探测（而不是直接写适配器）

代码层面已确证三件事：通用发现只认 4 个 setter 名、7 个关联键、12/96/8 三层边界；抖音写入因此降级 `dom-native`；而所有读回/确认/ledger 都只读 `element.playbackRate`，对"UI 由 React state 驱动"结构性失明。

但**具体命中哪条缺口、以及哪条 setter 才是 UI 驱动路径**，静态代码无法回答——抖音的播放器结构不在仓库内，也不在公开契约里。EPR-028 要求结论以已验证能力为界，所以先取证。

探测脚本把这一步变成一次可复现的实验，而不是靠肉眼翻对象。

---

## 1. 探测脚本的四个层级

| 层 | 做什么 | 是否改页面 | 输出 |
|---|---|---|---|
| T0 | 用**真实构建产物** `dist/content-page-media-bridge.js` 的协议发一次 `probe`，问它能否看到 `speed` | 否（只加/删一个属性） | `supported: true/false` |
| T1 | 重放桥的发现启发式并**同时**按扩展假设扫描，逐条解释"为什么被拒" | 否（只读对象） | 近失候选 + 拒绝原因计数 |
| T2 | 定位倍速标签，读取其文本、位置、React fiber 链 | 否 | 标签候选 + 组件链 |
| T3 | **显式调用**候选 setter，观察"真实速率"与"标签"是否一起变，随后还原 | 是（可关闭） | 哪个 setter 驱动 UI |

T1 的四类拒绝原因，正好对应根因报告里的四个白名单维度：

- `setter-name`：有 speed setter，但名字不在 `setPlaybackRate | setPlaybackRateByUser | changePlaybackRate`
- `getter-name`：没有 `getPlaybackRate`，也没有 `playbackRate` 访问器对
- `association-key`：控制器持有媒体元素用的键不在 `video | media | mediaElement | element | root | el | container`
- `property-index` / `ancestor-depth`：形状完全正确，只是挂在第 96 个属性之后 / 第 12 层祖先之外

---

## 2. 运行前检查

1. Chrome / Edge 已安装 SPECTRA，且在目标站点启用（T0 依赖真实桥；未装扩展也能跑 T1–T3，但 `installed` 会是 `false`）。
2. 打开 `https://www.douyin.com/`，进入任意视频播放页，**让视频开始播放**（未挂载的播放器没有可探测的控制器）。
3. 建议**暂停**视频。T3 会改倍速，暂停可避免"听到 1.5 倍速"的干扰，也便于人工确认 UI。
4. 打开 DevTools → Console。若提示 "Warning: Don't paste code…"，按提示输入 `allow pasting`。
5. 若播放器在 iframe 内：先用 Console 左上角的执行上下文选择器切到该 iframe，再粘贴脚本。桥只注入到它所在的文档，跨 frame 探测无意义。

---

## 3. 执行步骤

### 3.1 载入

打开 `tools/probes/douyin-speed-probe.js`，全选复制，粘贴到 Console 回车。看到：

```
SPECTRA Douyin probe v1.0.0 loaded — __SPECTRA_DOUYIN_PROBE__.help()
```

### 3.2 只读取证（T0–T2）

```js
__SPECTRA_DOUYIN_PROBE__.run()
```

期望输出（正常诊断路径）：

```
T0 bridge(speed)   supported=false installed=true
T1 discovery       candidates=… nearMiss=…
{ setter-name: 2, association-key: 1, … }
verdict            discovery-gap — A speed-capable controller exists but the bridge whitelist rejects it.
```

若 `supported=true`，说明桥在**当前这次会话**已经能看见 speed controller（可能与报告结论不符）。此时不要继续 T3，直接 `copy()` 保存，并记录页面版本/时间——这属于"结论需要修正"的信号。

### 3.3 写入验证（T3，可选但强烈建议）

```js
await __SPECTRA_DOUYIN_PROBE__.tryWrite({ desired: 1.5 })
```

行为：

1. 先做 **DOM 对照**：`video.playbackRate = 1.5`，观察标签是否变化；
2. 再逐个尝试候选 setter（最多 8 个，命中标签变化即停）；
3. 每次尝试后都用同一个 setter + DOM 双重还原到进入时的倍速。

判读：

| `changedRate` | `changedLabel` | 含义 |
|---|---|---|
| true | false | 该 setter 只改媒体元素，不改 UI —— 正是当前 bug 的形态 |
| true | true | **该 setter 就是 UI 驱动路径**，`uiDrivingSetter` 会指向它 |
| false | true | setter 只改 UI 状态、没改媒体元素 —— 需要"setter + DOM"双写 |
| false | false | 该 setter 与倍速无关或参数不兼容 |

如果 T3 结束后标签仍停在 `1.5x`，手动点一次站内倍速菜单恢复即可（脚本已尽力还原，但页面可能有额外副作用）。

### 3.4 导出证据

```js
__SPECTRA_DOUYIN_PROBE__.copy()
```

粘贴到新建文件：

```
nexus/docs/research/evidence/2026-11-01-douyin-speed-probe.json
```

（`evidence/` 目录不存在时新建；证据文件与报告同批评审。）

同时在文件头补三条人工观察，脚本无法代劳：

- 页面形态：桌面网页 / 移动 web / 站内嵌 iframe
- 倍速标签的实际文案样式（`1.5x` / `1.5倍` / 仅图标）
- 手动改倍速时，标签是否立即更新（确认"反向同步正常"这一前提）

---

## 4. 结果 → 注册表字段映射

按 `SiteAdapterEntry`（方案 §3.1）逐字段填：

| 探测证据 | 注册表字段 | 取值规则 |
|---|---|---|
| `write.uiDrivingSetter` = `Object.setSpeed` | `setterNames` | 取方法名 `setSpeed`；同族候选按命中顺序补齐 |
| `speedSurface` 中 `getPlaybackRate` | `getterNames` | 有则填；无则留空 |
| `speedSurface` 中 `playbackRate` accessor | `accessorProp` | 仅当 getter/setter 成对存在 |
| `nearMisses[].associationKey` = `videoEl` | `associationKeys` | 填实测键；保留 `video` 等旧键作回退 |
| `nearMisses[].propertyIndex` = 110 | `maxAttachedProperties` | 向上取整到 128，留余量 |
| `nearMisses[].ancestorDepth` = 14 | `maxAncestorDepth` | 向上取整到 16，留余量 |
| `projection.labels[].path` + `text` | `uiProjection{kind:'dom-label'}` | `selector` 用稳定属性优先（`data-*` > class 链）；`parse` 用 `/(\d+(?:\.\d+)?)/` |
| `projection.react.chain[].speedProps` | `uiProjection{kind:'react-state'}` | 仅当 `dom-label` 不可用时启用；记录字段名与组件名 |
| `attempts[0].changedLabel`（DOM 对照） | 决策依据 | `false` → 必须走 declared adapter；`true` → 停止，重新诊断 |

**准入判定**（必须全部满足）：

1. T0 在扩展启用时稳定返回 `supported=false`（连续 3 次刷新）；
2. T1 至少命中一条拒绝原因，且能指出具体控制器；
3. T3 找到 `changedRate && changedLabel` 的 setter，或明确记录"只能改 UI 状态"的双写需求；
4. T2 找到可稳定解析的 UI 投影来源，且在 T3 中与标签同步变化；
5. 证据 JSON 已落盘并附人工观察。

任一条不满足 → 条目不写入注册表，改走方案 §9 的开放问题（可能是 iframe、闭包持有、或 UI 只能通过菜单交互改变）。

---

## 5. 常见异常与处置

| 现象 | 可能原因 | 处置 |
|---|---|---|
| `No <video>/<audio> found` | 播放器在 iframe / 尚未挂载 / 用了 canvas 播放 | 切换执行上下文；确认视频已开始播放；若确为 canvas，记录并终止（无媒体元素可控制） |
| `T0 installed=false` | 扩展未启用或未注入该站点 | 检查 `chrome://extensions`，刷新页面后重试 |
| `T0 error: no result attribute` | 桥版本不匹配（协议 v2 变更） | 记录扩展版本；对照 `shared/page-media-bridge.ts` 的协议常量 |
| `nearMiss=0` 但有标签 | 控制器经闭包/fiber 持有，属性不可枚举 | 归入 `unreachable-controller`；条目的 `setterNames` 无法确定，需改用 UI 交互式适配（另立方案） |
| T3 后倍速未还原 | setter 有异步副作用 | 手动点站内倍速菜单；在证据中标注 `allRestored:false` |
| Console 拒绝求值（CSP） | 极少数站点策略 | 改用 DevTools → Sources → Snippets 运行；或通过扩展 MAIN world 注入执行 |

---

## 6. 自证：为什么可以先信这个脚本

`bun tools/probes/verify-probe.ts` 会在本地起 Chrome，加载**真实构建的桥**与夹具页面，跑 19 项断言。夹具刻意做成"抖音形状"：

- 标签由 `PlayerCore.setSpeed()` 渲染，**不读** `video.playbackRate`；
- 四条控制器分别制造 `association-key` / `setter-name` / `property-index` / `ancestor-depth` 四种缺口；
- 另有一页 `?mode=legacy`，控制器形状合规，桥应返回 `supported=true`。

当前结果：`19/19 checks passed`。其中两条是整条论证的缩影：

```
PASS  dom-native control moves rate but not label
PASS  state-driven setter moves both
```

也就是说：**同一个页面上，DOM 写只改速率不改标签，而站点自己的 setter 两者都改**——这正是"单向不同步"的机制本身，也是 declared adapter 必须调用站点 setter 的直接理由。

自证通过只证明"脚本能正确归因一个已知形状的页面"，不证明抖音就是这个形状。后者只能由 §3 的实机运行回答（EPR-028）。

---

## 7. 运行记录模板

```markdown
- 运行时间：
- 扩展版本 / Chrome 版本：
- 页面 URL 与形态：
- T0：speed supported=… / volumeBase=… / mediaMuted=…
- T1：candidates=… nearMiss=… reasonCounts=…
- T2：labels=…（选中：…）react=…
- T3：uiDrivingSetter=… / domWriteMovesLabel=… / allRestored=…
- 人工观察：手动改倍速标签是否更新；标签文案样式
- 结论：discovery-gap / unreachable-controller / bridge-ok / inconclusive
- 证据文件：research/evidence/…json
```
