---
type: explanation
status: draft
audience: developer
owner: spectra-douyin-video-to-live-switch
last_reviewed: 2026-11-14
---

# 抖音「视频切到直播」自动同步的重审与修复（2026-11-14）

> 结论对提交 `8c644981` 成立。证据等级 `[E-current]`，见
> [真站证据](evidence/2026-11-14-douyin-video-to-live-switch-proof.json)。
> 本文不改写 [O9 重审报告](2026-11-14-spectra-o9-smoke-repair.md) 与
> [音量可听路径重审](2026-11-14-spectra-volume-audible-path-reaudit.md) 的结论。

## 1. 先认错：上一轮收口收早了

用户再次反馈「抖音切到直播自动完美同步还是没做到」。复核后确认投诉成立。

上一轮把「站点原生 UI 不同步」收为 `guarded`，依据是三份真站证据。
但那三份证据全部是**直接打开直播间**后的静态结果：写 `element.volume` 能改变声音、
站点自己的 `volumechange` 会更新音量条。没有任何一轮覆盖「从视频切到直播」这个**过程**，
也没有一轮检验「切换后完全不碰按钮，插件是否自己保持在直播上」。

本轮补的正是这个缺口。

## 2. 复现方式

用两个只读探针盯住整个过程，而不是只看结果：

- `scripts/probe-douyin-transition.mjs`：无扩展，反复采样页面所有媒体元素的
  `srcObject` 轨道数、`duration`、`paused`、`volume`、布局面积与站点音量控件数字。
- `scripts/probe-douyin-switch-control.mjs`：加载生产扩展，反复采样
  `spectra.control.tab.<tabId>` 快照、角标、站点音量数字，并被动记录
  `actual.read` 响应与每一次快照写入。

浏览器为本机 Chrome `157.0.8103.39`，扩展经 CDP `Extensions.loadUnpacked` 加载，
视口 `1600×1200`（沿用上一轮 viewport 根因的结论）。

## 3. 真站实际形态

`https://live.douyin.com/` 门户的切换不是「删掉旧 video 再加新 video」，
而是**同一个 `<video>` 元素换流**：

| 阶段 | 主播放器 | 站点音量控件 |
|---|---|---|
| 视频阶段 | `videoTracks=1 / audioTracks=0`、`duration=NaN`、`paused=true`、`volume=0.6`、面积 345387 | 60 |
| 切换后 | `videoTracks=1 / audioTracks=1`、`duration=Infinity`、播放中、`volume=0.6`、面积 345387 | 60 |

旁边还有若干个有限时长、静音的预览视频。切换后几秒，站点会再挂一个
**10×10 像素、2.6 秒、正在播放**的小视频，随后又移除它。

`www.douyin.com` 本轮仍是验证码中间页、0 个媒体元素，无法采样。

## 4. 修复前：状态永久停在 idle

带生产扩展的诊断时间线（相对时刻）：

| 时刻 | 后台快照 | 页面 |
|---|---|---|
| 视频阶段 | `volumeBase.actual=100`、`activeMedia` 指向预览 | 站点显示 60 |
| 切换瞬间 | `actual=60`、`live=true` | 直播开始播放 |
| +5275ms | `activeMedia=media:3:9`、`actual=100` | 10×10 小视频被挂上 |
| +5306ms | `activeMedia=null`、`actual=null`、`phase=idle` | 小视频被移除 |
| 之后 14 个采样 | 一直 `null / idle`，没有自动恢复 | 直播一直在播，站点仍是 60 |

手动拖一次滑块到 30 后，`element.volume=0.3`、站点数字 30、角标 30 全部恢复。
也就是说：**不点就没目标，点一下才恢复**，这正是用户说的「自动没做到」。

因果链有四环：

1. `handleSourceReleased` 在「离场的恰好是当前 activeMedia」时把 `activeMedia` 置
   `null`，并用 `retireMediaActualFields` 把 `volumeBase` 置 `idle`。
2. 主直播一直没离场，内容侧 registry 的 `selectionVisit` 也没变，
   因此**不会再发 `selected`**，后台没有任何后续事件去重读当前呈现。
3. 主播放器在 `duration=NaN` 时不算 `isLiveMedia`，且 IntersectionObserver 几何到达前
   `visibleArea=0`，于是「正在播放的预览」在比较里压过它，读到预览的 `volume=1` → 100。
4. `play` 事件用「所有记录里挑最优」挑候选，没走其它生命周期事件共用的准入规则，
   让 10×10 小视频也能短暂抢到选中。

## 5. 修复：四处最小改动，不新增机制

| 文件 | 改动 |
|---|---|
| `src/background/control-coordinator.ts` | source release 清空 activeMedia 后，复用 `handleTargetChanged` 已在用的被动视图读，把仍在屏幕上的呈现重新投影。这是补齐已有路径的义务，不是新建重试机制。 |
| `src/content/core/media-registry.ts` | `mediaRank` 把「挂了 MediaStream」与 `isLiveMedia` 并列为呈现证据；`best()` 在几何仍为 0 时回退到元素自身布局盒；`play` 改走 `admitBetterCandidate`。 |
| `test/control-coordinator.spec.ts` | 单测桩补答这次额外的被动读：页面已无其它播放器时返回 `capability-unavailable`，不复活已退休目标。断言一条未放宽。 |
| `test/smoke/douyin-video-to-live-switch.spec.ts` | 新增 `SPECTRA_DOUYIN_SWITCH_URL` 门控真站用例。 |

用例的硬顺序是：先用 `sessionStorage` 采样器证明「确实发生了 video-only → live」，
然后**九秒内不发任何 popup、快捷键、快照写入或控制意图**，才允许断言
`activeMedia` 非空、`live=true`、`volumeBase.phase=applied`、
`volumeBase.actual` 等于站点自己的音量数字；最后才做一次真实 toolbar 手势。

## 6. 真站证据

从 `8c644981` 重建产物（哈希见证据 JSON），正式轮结果：

- 抖音门户：`1 pass / 0 fail / 11 expect()`。采样 85 帧，其中 5 帧 video-only、
  80 帧 live。九秒被动窗口后 `activeMedia=media:2:1`、`volumeBase=60`，
  站点音量控件也是 60。随后手势到 30，元素音量 0.3、站点数字 30、角标 30。
- 三轮稳定性复跑：全部通过，站点与插件在手势前均为 60。
- 虎牙 102411 `documentOutput` 回归：`3 pass / 0 fail / 65 expect()`，
  产品输出 RMS 在 `volume-0` 与 `mute` 为 0，`volume-70`、`unmute`、`shortcut` 非零。

虎牙共跑三轮，其中一轮在最后的「快捷键 ACK」超时（前 63 个断言已通过），
随后两轮全绿。按真站抖动登记，不用放宽断言掩盖。

## 7. 剩余项：不冒充「完美」

诊断仍记录到启动阶段 3 次短暂 `volumeBase=100` 与 5 次短暂 `idle` 写入。
每一次都会自动重投影回 `media:2:1 / 60`，最后三个采样全部是 `60 / media:2:1`。
但插件数字在启动的一小段时间内仍可能闪到 100。这一项登记为
[未决项清单](../proposals/open-items-program.md) 的 **O11**，不写成 `guarded`。

`www.douyin.com` 与「跨 origin 整页导航进直播间」同样没有当前 HEAD 的真站证据。

## 8. 取舍

没有引入站点适配、合成手势、新的观察 lease 或全局输出 gain 拦截。
修复只用系统中已经存在的两个动作：内容侧既有的准入规则，
以及后台既有的被动视图读。判断标准是「上一版能用的行为」——
切换后不需要用户点一下，插件就该留在直播上且数值与站点一致。

[09 故障索引](../../apps/extension-spectra/docs/control/09-failure-index.md) 的第 2 行
此前把这条症状标为 `guarded`，本轮补上它真正缺的那一环与真站链接；
`status: draft` 仍按既有约定保留。
