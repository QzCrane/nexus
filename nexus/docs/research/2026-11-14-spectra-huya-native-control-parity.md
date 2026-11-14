---
type: explanation
status: draft
audience: developer
owner: spectra-huya-native-control-parity
last_reviewed: 2026-11-14
---

# 虎牙原生控件双向同步与暂停读回失配（2026-11-14）

> 证据等级 `[E-current]`：本机 Chrome 157.0.8103.39 + 生产产物 + 真站
> `https://www.huya.com/102411`，见
> [真站证据](evidence/2026-11-14-huya-native-control-parity-proof.json)。
> 本文不改写 [音量可听路径重审](2026-11-14-spectra-volume-audible-path-reaudit.md)
> 的可听性结论，只纠正它 §13.3 写下的「虎牙未单独采样」边界。

## 1. 用户反馈与上一轮的收口偏差

用户反馈：

> 为什么不做完
>
> `Playback readback mismatch: requested playing=false; after write=false; stable=true`
> 是虎牙暂停按钮永远这样，而且音量同步双向都永远不行

投诉成立。上一轮把「站点原生 UI 不同步」收为 `guarded`，依据是三份真站证据：
虎牙的 `documentOutput` / Capture 输出 RMS、抖音直播间的 `dom-native` 可听性、
以及抖音切换过程的自动重投影。它们分别证明的是 **S-A 可听音量** 与
**抖音站点的 UI 数字**，没有一轮把虎牙**自己的原生控件**当成 oracle：

| 用户诉求 | 上一轮证据 | 缺口 |
| --- | --- | --- |
| 虎牙暂停按钮不报错 | 无 | 从未在虎牙按过插件暂停按钮并读 ACK |
| 虎牙站点音量 → 插件 | 无 | 只在抖音直播间采过 `volumechange` |
| 插件音量 → 虎牙站点音量条 | 无 | RMS 只证明扩展自己的输出响度，站点条没动 |

[重审报告](2026-11-14-spectra-volume-audible-path-reaudit.md) §13.3 其实写明了
「站点 UI 跟随只在抖音直播间采样；虎牙未单独采样」，但这条边界没有被转成验收项。
本文的判据因此只用三样东西：虎牙自己的按钮/音量条 DOM、扩展发布的字段快照与角标、
真实 viewer 输入。RMS、Capture 状态、直接打开直播间的静态结果都不算完成证据。

## 2. 真站复现方法

- 从工作树重建生产产物（`manifest.json` 等 7 个哈希见证据 JSON），用 CDP
  `Extensions.loadUnpacked` 装进 `C:/Program Files/Google/Chrome/Application/chrome.exe`。
- 视口 `1600×1200`；页面滚动 420px 后，先把鼠标移到 `#player-wrap` 中心让控制条显形，
  再 hover `#player-sound-btn` 让音量滑块显形。少任何一步，冷播放器会吞掉拖动。
- 站点侧一律用真实鼠标输入：拖 `.sound-btn`、点 `#player-btn`；扩展侧用
  `Extensions.triggerAction` 打开可信 popup，点 `.btn-pause`、用真实键盘驱动 `.vol-slider`。
- 只读侦察探针在 page / isolated 两个 world 包裹
  `HTMLMediaElement.prototype.play/pause` 与 `volume` descriptor 记录调用栈；
  另一个探针用 tabCapture + `AnalyserNode` 采样产品输出 RMS 作为可听性 oracle。

## 3. 根因 A：暂停被站点自己的播放器重新拉起

修复前插件暂停的 ACK：

```json
{ "desired": false, "actual": null, "phase": "error",
  "lastError": { "code": "readback-mismatch",
    "message": "Playback readback mismatch: requested playing=false; after write=false; stable=true" } }
```

同一轮 isolated world 的时间线（毫秒为页面内相对时钟）：

| t | world | 事件 | paused |
| --- | --- | --- | --- |
| 33333 | isolated | `call:pause`，栈来自 `content-runtime.js -> zr.applyField` | false |
| 33339 | `event:pause` | | true |
| 33363 | `event:play` | | false |
| 33363 | `event:playing` | | false |

后续探针在 page world 抓到 `prototype.play` 的调用方是虎牙自己的
`https://a.msstatic.com/huya/h5player/room/.../vplayer.js`。因果链是：

```text
扩展 isolated world 调 element.pause()
  -> 浏览器发出 pause 事件，元素确实停了
  -> Huya vplayer.js 的内部状态仍是「观看中」，约 30ms 后再次调 play()
  -> writePlaybackWithStableAck 等稳定读回，读到 true
  -> requested=false 与 stable=true 不一致，必然抛 readback-mismatch
```

所以这不是 ACK 判据太严，也不是时序偶发：**站点才是播放状态 owner**，
`element.paused` 只是它写出来的镜像。真站点自己的 `#player-btn`
（`player-pause-btn` / `暂停观看`）能把状态改成
`player-play-btn` / `开始观看` 且让 `hy-video.paused=true` 保持不变。
诊断探针还确认：在 isolated world 派发合成 `MouseEvent('click')`
就能走到虎牙自己的 handler，不需要 page-global API，也不需要 CDP 输入。

## 4. 根因 B：音量双向只走通了一半

### 4.1 站点 → 插件：本来就能跟，但没被验收

真实拖动 `.sound-btn` 从 0.5 到 0.12 后：`element.volume=0.12`、
`.sound-bar` 43.5px → 12.5px、扩展 `volumeBase=12`、角标 `12`。
原生 `volumechange` 观察链是好的。此前只是没有把虎牙这一方向列为验收项。

### 4.2 插件 → 站点：整条链路缺失

插件滑杆在 `documentOutput` 页走 Capture 处理器：snapshot / 角标显示 70，
而 `hy-video.volume` 仍是 0.5、`.sound-bar` 仍是 43.5px。

三个诊断决定了修复方向：

1. **写 DOM 镜像无效**：外部写 `element.volume=0.8`，`.sound-bar` 仍是 12.5px，
   snapshot 仍是 70。`element.volume` 只是镜像，站点 UI 与站点增益都不跟。
2. **只改处理器增益也无效**：站点 UI 停在旧数字，扩展显示另一个数字。
3. **站点条才是可听输出 owner**：同一轮 tab RMS 采样

   | 站点条 | element.volume | 产品输出 RMS |
   | --- | --- | --- |
   | 43.5px | 0.5 | 0.0240985 |
   | 5px | 0.03 | 0.0001600 |
   | 77px | 0.9 | 0.0725858 |

   合成 pointer/mouse 输入从 product 所在的 isolated world 派发到
   `.sound-progress`，能把 `.sound-bar` 从 12.5px 推到 67px、
   `element.volume` 推到 0.78；合成 click 也把 `#player-btn` 从暂停态切到播放态。

结论：必须驱动站点自己的控件，并且把「站点实际电平」与「处理器增益输入」分开。

## 5. 修复落地

| 文件 | 改动 |
| --- | --- |
| `src/content/logic/site-native-control-surface.ts` | 新模块。观察优先地发现站点自己的播放按钮与音量轨道；`projectSiteNativePlayback` 先点站点按钮再走原有稳定 ACK；`projectSiteNativeVolume` 用有界合成输入驱动站点轨道，以站点 `.bar` 宽度（不是 DOM 镜像）为证人，最多三轮校准，够不到就返回 `null`。找不到控件、harness 无 DOM 时整模块是 no-op。**不写 `element.volume`**。 |
| `src/content/logic/native-media-executor.ts` | `playing` 与 `documentOutput` 下的 `volumeBase` 先做站点投影；在此处（唯一的 canonical media writer）对齐 DOM 镜像，处理器保持 unity；ACK 里把 runtime 的 `volumeBase` 显示值改成站点实际电平，保留原有 `strategy`/`coverage`，以免破坏字段状态契约。 |
| `src/content/logic/audio-runtime-control-delegate.ts` | 新增 `siteNativeLevel` 证人，分离 gain input 与 display level；被动读不再把处理器的 100 报成观众看到的音量。 |
| `test/site-native-control-surface.spec.ts` | 4 条单测：无 DOM no-op、document 无查询方法不抛、点击站点按钮而不是被否决的 DOM pause、按站点条校准并对齐镜像。 |
| `test/smoke/huya-native-parity.spec.ts` | 门控真站用例：站点拖动 → 插件、插件暂停/恢复、插件滑杆 → 站点，三段都只用真站 DOM 与已发布快照作断言。 |

被否决并已撤销的做法：在 `NativeMediaExecutor.read()` 里直接用站点条宽度覆盖
`volumeBase`。它让 popup 出现 `Control state unavailable` / `aria-pressed="mixed"`，
因为 RPC v2 校验要求 `strategy=capture` 的 `coverage` 只能是 `full` 或 `opaque`。
最终改为在 delegate 内做证人，保留 runtime 已生成的字段状态。

第一次 `verify` 还报 `SCTRL-003: unowned volume writer at site-native-control-surface.ts`。
`SCTRL-003` 要求 `volume` 只有一个 canonical writer；没有放宽门禁，也没有改 baseline，
而是把镜像对齐写回 `native-media-executor.ts`，并加一条单测断言投影模块不碰
`element.volume`。修复后 `verify` 为 `0 error / 8 已登记 warning`。

## 6. 修复后的真站证据

门控用例 `test/smoke/huya-native-parity.spec.ts` 共七轮全绿，数值七轮完全一致。
最终验收以**已提交 HEAD `332fe7a` 重建的产物**为准
（`content-runtime.js` SHA-256 `b4bcffb3…`，与提交前工作树构建逐字节一致）：
正式两轮各 `1 pass / 0 fail / 16 expect()`，比中间轮多两条站点控件存在性断言：

| 方向 | 站点 | 扩展 |
| --- | --- | --- |
| 站点 → 插件（真实拖动） | `element.volume=0.12`，`.sound-bar=12.5px` | `volumeBase=12` |
| 插件暂停 | `#hy-video.paused=true`，按钮 `开始观看` | `playing.phase=applied`，`actual=false`，`lastError=null` |
| 插件恢复 | 重新播放 | `playing.phase=applied`，`lastError=null` |
| 插件 → 站点（真实键盘到 70） | `element.volume=0.7`，`.sound-bar=63px` | snapshot 70、popup 滑杆 70、角标 70 |

复现命令：

```bash
cd nexus/apps/extension-spectra
SPECTRA_HUYA_PARITY_URL=https://www.huya.com/102411 \
NEXUS_CHROME_EXECUTABLE="C:/Program Files/Google/Chrome/Application/chrome.exe" \
bun test test/smoke/huya-native-parity.spec.ts
```

## 7. 仍然成立的边界（不冒充完美）

- **站点物理上限**：90px 轨道 + 10px 手柄使轨道点击的最大电平约 0.944。
  请求 100 时真实结果为 `.sound-bar=85px`、`element.volume=0.9444`，
  扩展如实 ACK `94`，不谎报 100；请求 30 时准确落到 0.3 / 27px / 30。
- **降级行为**：找不到站点控件，或三轮校准仍够不到目标（容差 6），
  投影返回 `null`，沿用原有路由；普通 `dom-native` 页面不受影响。
- **`boost > 100`** 仍走已验证的 Capture 处理器增益，站点 UI 物理上无法同步。
- **RMS 采样边界**：修复后的独立 tabCapture 采样器会报
  `Cannot capture a tab with an active stream.`（扩展已持有 capture）；
  站点条的可听性结论取自修复前同一轮的 `0.024 → 0.00016 → 0.0726` 对比，
  不跨轮比较，也不拿它冒充双向 UI 证据。
- **不覆盖范围**：Chrome 157 之外的版本、其他虎牙房间/播放器版本/视口、
  抖音与 `www.douyin.com`（验证码中间页）、O11 启动阶段短暂 `100` / `idle` 闪动。
- `applied` 仍只表示物理值写入并读回一致，不宣称节目响度变化。

## 8. 交付闭环

- 门禁实测：`bun scripts/run-tests.ts` 138 个隔离单测文件全过
  （新增模块单测 `5 pass / 19 expect()`）、`typecheck` exit 0、
  `bun run build` exit 0（88/89 产物可达、1 条已登记发布提示）、
  全量 `test:smoke` `102 pass / 7 skip / 0 fail / 783 expect()`、
  `verify` `0 error / 8 已登记 warning`、Strict Biome `0 diagnostics`、
  `docs:check` 160 篇 strict 通过、额外全树扫描 421 个相对 Markdown 链接 /
  81 个 Mermaid 块 / 0 个围栏异常（唯一失效链接在 `_archive/2026-Q3`，
  为既有存量，不在官方 strict checker 覆盖范围内）。
- 交付：修复提交 `332fe7a`（`fix(spectra): sync huya native playback and volume controls`），
  随后补文档与证据。`check-public-parity` 真实入口与 `sync-public.ts spectra --amend`
  在提交后运行，结果记入 [未决项总表](../proposals/open-items-program.md) §12。
- 文档：[09 故障索引](../../apps/extension-spectra/docs/control/09-failure-index.md)
  补两条症状行并纠正「虎牙未单独采样」；[未决项总表](../proposals/open-items-program.md)
  §12 记录本轮；[研究索引](README.md) 增加本组证据。
- 证据：[真站证据 JSON](evidence/2026-11-14-huya-native-control-parity-proof.json)。
