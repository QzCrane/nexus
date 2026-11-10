---
type: reference
status: stable
audience: all
owner: spectra-guide-glossary
last_reviewed: 2026-11-09
---

# 术语表

> 按"你可能听到的说法 → 它实际是什么 → 在本项目里对应哪个东西"组织。
> 这里只做解释，不定义行为。行为定义在 [control/](../control/README.md)。

---

## A. 网页与 DOM

| 词 | 英文 | 实际是什么 | 本项目对应 |
| --- | --- | --- | --- |
| 网页 / 页面 | page | 浏览器里打开的一份文档及其资源 | — |
| DOM | Document Object Model | 浏览器把 HTML 解析成的一棵**活的对象树** | 内容脚本操作的对象 |
| 节点 | node | 树上任意一个点（元素、文本、注释） | — |
| 元素 | element | 标签对应的那个 JS 对象（`<video>`、`<div>`） | `HTMLMediaElement` 实例 |
| 文档 | document | 一次页面加载产生的文档对象；刷新就换新的 | `documentId` |
| 属性 | property | 元素**对象上**的字段，读写立即生效 | `element.volume`、`element.muted` |
| 特性 | attribute | HTML 文本里写的初始值，通常不影响当前状态 | 本项目基本不用 |
| 选择器 | selector | `querySelector('.cls')` 这类查找语法 | 故意少用（站点 class 会变） |
| 挂载 | mounted / attached | 元素在文档树上 | `isConnected === true` |
| 摘除 | detached | **元素不在文档树上**（`isConnected === false`）；对象仍可操作 | `removed` 事件的 `detached` 原因 |
| 跨任务搬家 | remount | 框架先删后插，中间隔了一次事件循环；同一个播放器被误判成新的 | 会换新 `mediaId` |
| 同源 | origin | 协议 + 域名 + 端口三者全同 | 决定字段能否跨页面继承 |
| SPA | Single Page Application | 改 URL 但不重新加载文档 | URL 变、`documentId` 不变 |

---

## B. 时间与渲染

| 词 | 英文 | 实际是什么 | 本项目对应 |
| --- | --- | --- | --- |
| 任务 | task / macrotask | 一次事件回调、一个定时器；一次跑一个 | 一次手势处理 |
| 微任务 | microtask | `Promise.then`、`await` 后续、`queueMicrotask`；当前任务结束后立即清空，**在渲染之前** | 合并同批 DOM 变更、判断谁离场 |
| 帧 | frame | 浏览器约每 16.7ms 一次的绘制周期 | "可见"的唯一成立尺度 |
| 布局 | layout / reflow | 计算每个元素的位置和大小 | `visibleArea` 只能在这之后拿到 |
| 强制同步布局 | forced reflow | 读 `offsetWidth` 等会逼浏览器立刻算布局 | 性能陷阱，避免在循环里做 |
| 渲染管线 | render pipeline | 样式 → 布局 → 绘制 → 合成 | — |
| 观察者 | observer | 浏览器在合适时机通知你，不阻塞 | 见 C 节 |

---

## C. 两类观察者

| 词 | 英文 | 看什么 | 什么时候回调 | 本项目用途 |
| --- | --- | --- | --- | --- |
| 变更观察者 | `MutationObserver` | 树的增删改 | 一批变更做完（渲染前） | 发现新播放器、发现被移除 |
| 交叉观察者 | `IntersectionObserver` | 元素可见性和露出比例 | 帧尺度 | 判断"真的看得见" |

**关键区别**：前者在布局**之前**，所以拿不到尺寸；后者在帧上，所以能。

---

## D. 事件

| 词 | 英文 | 实际是什么 | 注意 |
| --- | --- | --- | --- |
| 事件 | event | 页面表达"发生了什么"的唯一方式 | — |
| 监听 | listener | `addEventListener(type, fn)` | — |
| 冒泡 | bubbling | 事件从目标往上传播 | **媒体事件不冒泡**，必须逐元素挂 |
| 捕获 | capture | 事件从 window 往下传播 | — |
| 委托 | delegation | 在外层挂一个监听处理所有子元素 | 媒体事件用不了这招 |
| 用户手势 | user activation / transient activation | 用户真实操作后的一小段授权窗口 | Capture、有声播放需要它 |
| 媒体事件 | media events | `play`/`pause`/`volumechange`/`loadedmetadata`/`emptied`/`seeked` | 都是"事实"类 |
| 生命周期事件 | lifecycle events | 文档创建/销毁、导航 | 触发整份状态作废 |

---

## E. 媒体元素

| 词 | 英文 | 实际是什么 | 本项目含义 |
| --- | --- | --- | --- |
| 媒体元素 | `HTMLMediaElement` | `<video>` 和 `<audio>` 的共同接口 | 系统的控制对象 |
| 换源 | source change | `src` / `srcObject` 变化，或调用 `load()` | `sourceRevision` +1 |
| 重新加载 | `load()` | 清空缓冲、重新请求；**重置倍速，保留音量** | 决定重基时要不要重写 |
| 就绪状态 | `readyState` | 0–4，表示有多少数据可播 | 判断能不能立刻写 |
| 直播 | live | 通常 `duration === Infinity`，数据持续产生 | 会反复重建 MSE |
| MSE | Media Source Extensions | 分片喂给 `SourceBuffer` 的播放方式 | 直播必须用 |
| 缓冲对象 | `SourceBuffer` | 存放待播分片 | 播放器内部，扩展不碰 |
| 轨道 | track | 字幕/音轨 | — |
| 播放速率 | `playbackRate` | 播放速度倍数 | 换源后被重置为 1 |

---

## F. 音频

| 词 | 英文 | 实际是什么 | 关键边界 |
| --- | --- | --- | --- |
| 元素音量 | `volume` | 0 到 1，**上限是 1** | 写 1.5 会被拒绝 |
| 静音 | `muted` | 独立开关，和 volume 互不影响 | 有些站点用 volume=0 表示静音 |
| 音频上下文 | `AudioContext` | Web Audio 的处理环境 | Service Worker 里没有 |
| 源节点 | `MediaElementAudioSourceNode` | 把媒体元素的音频"接出来" | 一旦接出，必须连到 destination |
| 增益 | `GainNode` | 放大器，`gain.value = 4` 就是 4 倍 | **突破 100% 的唯一标准手段** |
| 捕获 | TabCapture | 抓整个标签页的音频 | 需要扩展界面触发的用户手势 |
| 有效音量 | effective volume | 元素音量 × 增益 | 本项目最高 800% |

---

## G. 扩展的运行环境

| 词 | 英文 | 有 DOM？ | 有页面变量？ | 生命周期 | 本项目位置 |
| --- | --- | --- | --- | --- | --- |
| 后台 | Service Worker | 否 | 否 | 随时被回收 | `src/background/` |
| 内容脚本 | Content Script | 共享 | 否 | 跟文档 | `src/content/` |
| 隔离世界 | Isolated World | 共享 DOM | 否 | 跟文档 | 内容脚本就在这 |
| 页面世界 | MAIN World | 共享 | **是** | 跟文档 | `src/content/injector/` |
| 弹出页 | Popup | 自己的 | 否 | 开关即生死 | `src/popup/` |
| 侧边栏 | Side Panel | 自己的 | 否 | 常驻 | 视频控制 |
| 离屏文档 | Offscreen Document | 自己的 | 否 | 按需创建 | 音频处理 |
| 注入时机 | `run_at` | `document_start` 时页面还没内容 | — | — | 早注入 + 观察者 |

---

## H. 通信

| 词 | 英文 | 实际是什么 | 限制 |
| --- | --- | --- | --- |
| 消息 | message | 房间之间传的纸条 | 只能传可序列化数据 |
| 序列化 | structured clone | 把对象变成可传输的副本 | 函数、DOM 元素、类实例过不去 |
| 端口 | `Port` | 长连接，双向 | 断开要处理 |
| 广播 | broadcast | 后台发给所有 UI | UI 自己去拉最新快照 |
| 保活 | keepalive | 让内容脚本或后台别被回收 | 本项目有明确预算 |

---

## I. 项目内的身份标识

| 标识 | 是什么 | 变化时机 | 变了代表 |
| --- | --- | --- | --- |
| `tabId` | 浏览器标签页编号 | 开新标签 | 完全不同的会话 |
| `documentId` | 一次文档加载的编号 | 导航/刷新 | 整份状态作废（L1） |
| `frameId` | 页面内第几个框架（iframe） | — | 不同框架不能互写 |
| `mediaId` | 给每个媒体元素发的编号 | 元素被替换/重挂 | 换了控制对象（L2） |
| `sourceRevision` | 这段元素播的第几份内容 | `src`/`srcObject`/`load()` | 换了内容，不是换了对象（L3） |
| `generation` | 文档重初始化次数 | 重初始化 | 会话换代 |
| `revision` | 快照提交序号 | 每次提交 +1 | 账本更新 |
| `selectionVisit` | 选中访问序 | **只在选中对象变化时** +1 | 手势是否还有效 |

**四个最容易混的**：`documentId`（哪份文档）、`mediaId`（哪个播放器）、`sourceRevision`（第几段内容）、`revision`（第几版账本）。

---

## J. 字段状态

| 词 | 英文 | 含义 |
| --- | --- | --- |
| 期望值 | `desired` | 用户想要的值 |
| 实际值 | `actual` | 上次读回来的真实值 |
| 还原基线 | `restoreBaseline` | 写之前的原始值，离场时用来还原 |
| 相位 | `phase` | `applied`（已生效）/ `error`（失败） |
| 写状态 | `writeState` | `confirmed` / `written` / `drifted` / `unconfirmed` |
| 策略 | `strategy` | 用哪条路写的（原生、页面接口、WebAudio、Capture） |
| 覆盖度 | `coverage` | 这条路能覆盖多少个媒体元素（全部/部分） |
| 受控 | `controlled` | 这个值是不是扩展写的 |
| 漂移 | `drifted` | 写了，但页面又改回去了 → **这是纠正，不是失败** |
| 未确认 | `unconfirmed` | 写了，但没法确认 → **这是"不知道"，不是"错"** |

---

## K. 三种"变化"的正确反应

| 词 | 英文 | 触发条件 | 正确反应 | 错误反应 |
| --- | --- | --- | --- | --- |
| 重基 | rebase | 同一对象换了内容（L3） | 重新读实际值，继续 | 判为失败 |
| 重绑 | rebind | 换了对象（L2），但仍是同一个用户目标 | 迁移选中和未完成义务 | 全部丢弃 |
| 取消 | cancel | 用户真的换了目标 | 丢弃在途操作 | 继续写到旧对象 |

---

## L. 检查与预算

| 词 | 英文 | 实际是什么 |
| --- | --- | --- |
| 栅栏 | fence / guard | 提交前最后一次身份比对，不成立就整体作废 |
| 准入 | admission | 判断"这个值/这条能力现在允许吗" |
| 预算 | budget | 异步等待的上限，决定"敢不敢宣称成功" |
| 截止时间 | deadline | 预算的绝对时间点 |
| 确认 | ACK / acknowledgement | 写入方给记账方的回执 |
| 收据 | receipt | 一次操作的完整结果（相位、策略、实际值） |

---

## M. 所有权

| 词 | 英文 | 实际是什么 |
| --- | --- | --- |
| 所有权 | ownership | 谁写了这个字段，谁负责在离场时把原值还回去 |
| 释放 | release | 把 `restoreBaseline` 写回元素，不把扩展的值留给页面 |
| 接管 | takeover | 从一条策略切到另一条（比如从原生切到增益） |

**一句话**：写的人负责还原。所以元素离场时要还值，换源时要丢弃旧所有权（不能把旧值写进新流）。

---

## N. 策略与能力

| 词 | 英文 | 是什么 | 什么时候用 |
| --- | --- | --- | --- |
| 原生 | native / dom-native | 直接写元素属性 | 0–100%，最稳 |
| 页面原生 | page-native | 调站点自己的接口 | 站点提供接口时，能让站点 UI 跟着变 |
| MediaElement WebAudio | media-webaudio | 接出元素音频加增益 | >100%，覆盖单个元素 |
| 捕获 | capture | 抓整个标签页音频 | >100% 且需要覆盖全部声音 |
| 生命周期 | lifecycle | 处理器状态（启动/运行/停止/错误） | 与字段状态分开记 |

---

## O. 常见误解对照

| 你可能会以为 | 实际上 |
| --- | --- |
| "元素被删了就没了" | 对象还活着，只是不在树上；`isConnected` 为 false |
| "改 HTML 就能改音量" | 只有改 property 才有效 |
| "事件都会冒泡" | 媒体事件不冒泡 |
| "微任务里可以等布局" | 微任务在布局之前，拿不到尺寸 |
| "后台一直活着" | Service Worker 会空闲回收 |
| "popup 可以自己记状态" | 一关就销毁，必须每次重读快照 |
| "换了 src 就是换了播放器" | 同一个元素可以播无数段内容 |
| "音量可以设到 150%" | 元素音量上限是 1.0 |
| "插件调了音量，站点 UI 该跟着动" | >100% 走的是插件自己的增益，站点根本不知道 |
| "报错说明能力不够" | 可能只是身份过期（生命周期错误） |
