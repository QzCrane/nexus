---
type: explanation
status: draft
audience: developer
owner: spectra-o9-smoke-repair
last_reviewed: 2026-11-14
---

# SPECTRA O9 六个 smoke 失败的重审与收口（2026-11-14）

> 本文只处理 [未决项清单](../proposals/open-items-program.md) 的 O9 与 O10。
> 结论对提交 `34718000` 成立。上一批（`0b907ee0`）的真站结论仍以
> [音量可听路径重审](2026-11-14-spectra-volume-audible-path-reaudit.md) §13 与
> [证据索引](README.md) 为准，本文不改写它。

## 1. 范围与判断标准

全量 `test:smoke` 在合入后稳定为 `96 pass / 5 skip / 6 fail / 772 expect()`。
三个文件单独复跑均稳定复现，排除并发污染。判断标准只有一条：**上一版能用的行为**。
每个失败先归类，再决定改产品还是改测试；任何归类都不通过放宽断言来「修好」。

| # | 用例 | 归类 | 处置 |
|---|---|---|---|
| 1 | `hotkeys` 冷默认快捷键监听所有权 | 测试期望过时 | 更新断言 |
| 2 | `popup-ui` worker 替换后的站点预设 badge | 测试期望过时 | 更新用例 |
| 3 | `live-target-restart` 直播旁更大广告（`paused=true`） | **产品回归** | 改 `media-registry.ts` |
| 4 | `live-target-restart` 被拒后的冷恢复 | **产品回归** | 改 `runtime-loader.ts` |
| 5 | `live-target-restart` 复用旧 media ID 的首个快捷键 | 测试期望过时 | 更新等待判据 |
| 6 | `live-target-restart` 缺失旧 media ID 的首个快捷键 | 测试期望过时 | 更新等待判据 |

## 2. 产品回归一：暂停的直播被更大广告接管

只有 `test.each([false, true])` 的 `paused=true` 实例失败：期望直播拿到 40% 并解除静音，
实测直播仍是 `volume 0 / muted`，而 640×360 的广告拿到了 0.4。

根因是 `content/core/media-registry.ts` 的 `reconcileRetiredSelection()`。
`live.pause()` 触发 pause 事件后，选中仍可见的分支会按「面积不小于 active、注册更晚」
挑 successor，完全没有调用 `mediaRank()` 的 live 优先类。广告面积更大且后注册，于是接管选中。
`compare()` 里「直播优先于有限时长呈现」的规则在这条分支被绕过了。

修复：successor 过滤增加 `mediaRank(record)[0] >= mediaRank(active)[0]`。
`video -> live` 的接管仍被允许（1 >= 0），`live -> ad` 被拒绝（0 < 1）。
这与用户最初反馈的「视频切出直播自动不能控制到直播」属同一条选中链，
也解释了为什么 11-11 的真站 viewport 修正后虎牙能选中直播。

## 3. 产品回归二：恢复计划被页面原生值污染

用例注入 service worker 的 `chrome.tabs.sendMessage` 闸门，让前两次
`source: 'restore'` 的 `spectra.control.intent.execute` 返回 `stale-media-source`，
随后放行并要求媒体生命周期信号自动消费站点预设 40%。

诊断输出给出了决定性事实：三次 intent 的补丁依次是
`volumeBase: 40`、`100`、`100`；闸门放行后没有新的控制请求能补救，媒体停在 `volume 1`。
模板本身没有丢（`mediaIntentState: retained`），丢的是**计划的值**。

根因是 `background/runtime-loader.ts` 的 `restoreIfConfigured()` 每次调用都重新执行
`resolveDocumentRestorePlan()`。第一次读到站点预设 40；两次尝试之间，
页面原生的 100 通过 `tabSession.rebind()` 成为会话值，后两次解析就把它当成用户偏好。

修复：新增 `pendingDocumentRestorePlans`，一个文档在恢复义务完成前只解析一次计划，
重试复用首次值；`submitControlRequest` 全部 ACK 后立即删除该条目，
`forgetDocument` 与测试重置同步清理。这是**保存既有义务**，不是新增恢复机制，
也不改变成功之后 SPA 导航重新解析的行为。修复后三次 intent 都是 40，媒体自动落到 0.4。

## 4. 测试期望过时的四处

1. **`hotkeys`**：`0b907ee0` 为可信输入见证新增了 6 个 window 监听
   （重复的 `keydown` 与 `pointercancel/down/move/up`、`wheel`），由一个 `AbortController` 持有。
   `dispose()` 走 `abort()`，不产生 `removeEventListener` 调用，所以探针只在 added 侧看到它们。
   旧断言的 16 项列表过时。改为把 AbortController 组单独列出，`added` 与 `removed` 都按同一排序规则精确比较，
   断言强度不变。
2. **`popup-ui`**：同上提交后，纯程序化的预设不再创建 badge usage，只有扩展侧已确认的手势可以。
   用例改为在读取 badge 前发一次中性的 popup 意图（`patch: { boost: 1 }`），
   不改动 0.73 / 0.54 的预设值，`'73'` / `'54'` 的严格断言保留。
3. **两个「首个真实快捷键」用例**：11-11 起，只要文档报告有媒体，background 就常驻一个
   `document-media-observation` lease。释放 smoke lease 不再让 runtime 整体下线，
   `ready: true` 是有意行为。等待判据改为「退役源与媒体意图已释放」
   （`ownedSources` 为空且 `mediaIntentState === 'unset'`）。
   后续断言保持原样，实测 `presentation: 0.5`、`preview: 1` 均成立。

## 5. 验证

| 门禁 | 结果 |
|---|---|
| 全量 `test:smoke` | `102 pass / 5 skip / 0 fail / 783 expect()`（14 文件） |
| `bun scripts/run-tests.ts` | 137 个隔离单测文件全通过 |
| `tsc --noEmit` | exit 0 |
| Strict Biome | 163 文件 0 diagnostics / 0 silent handlers |
| `verify` | 21 项 0 error、8 条已登记 warning |
| `docs:check` | 157 篇通过 |
| 锚点 / Mermaid | 78 个锚点 0 缺失；81 个图块围栏与括号 0 异常 |
| `check-public-parity` 真实入口 | `0 differing / 0 missing / 0 warnings / exit 0` |

真站证据见 [本轮回归证明](evidence/2026-11-14-o9-repair-real-site-regression-proof.json)：
从 `34718000` 重建产物，本机 Chrome `157.0.8103.39` 以 CDP `Extensions.loadUnpacked` 装载，
虎牙 102411 的 `3 pass / 65 expect()`，`strategy: capture`、`live: true`，
产品输出 RMS 在 volume-0 / muted 为 0，在 volume-70 / unmuted / shortcut 非零。
该文件明确列出 `notEvidenceFor`，不把 fixture 级修复冒充真站结论。

## 6. O10 发布同步

`bun scripts/sync-public.ts spectra --plan` 先验证公共候选可构建且门禁全绿；
随后正式运行把已提交源码投影到 `spectra-public`，生成候选提交 `9596b5f`
（68 文件变化，包含此前 `knownMissing` 的三个源码），脚本按设计**不 push**。

`public-parity-baseline.json` 随之从 `22 differing / 3 missing` **收紧**为 `0 / 0`。
这是收紧而非放宽：实际差异已是 0，收紧后任何未发布的 shipped source 改动都会立刻报错。
此前「不要改 baseline 掩盖」指的是不允许为通过而放宽，与本处方向相反。

## 7. 明确剩余与不做

- `spectra-public` 的候选提交 `9596b5f` 尚未推送到公共远端；推送是外部发布动作，不在本轮授权内。
- 本轮未重跑抖音直播间 `dom-native` 链路，也未重试被验证码拦截的 `www.douyin.com`。
- 未新增 SCTRL 编号不变量：两处产品修复是既有规则（`mediaRank` 的 live 优先、
  一次文档恢复义务）的实现修正，规则本身写在代码注释与本文，不新增架构机制。
- [09 故障索引](../../apps/extension-spectra/docs/control/09-failure-index.md) 的
  `status: draft` 与此前 `guarded` 状态保持不变。
