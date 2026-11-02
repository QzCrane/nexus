---
type: reference
status: stable
audience: developer
last_reviewed: 2026-11-02
---

# 06. Media & Video (Active media, media controls, video effects)

> 主题 owner 段: §13 Active media · §14 Media controls · §15 Video effects and screenshot
> 完整目录: [README.md](README.md)

## §13 Active media

每个注册媒体具备文档级目标标识 `MediaTarget`:

```ts
interface MediaTarget {
  frameId: number;
  documentId: string;
  mediaId: string;
  sourceRevision: number;
  kind: 'audio' | 'video';
}
```

- **目标选择**: 显式媒体选择保持粘性；新 `play` 事件按 `有效用户指针交互 -> 当前播放中 -> 可见面积 -> 最近播放 -> 注册顺序` 比较自动候选，不能因隐藏预览最后触发 `play` 就覆盖主播放器。已结束媒体、暂停或不可见视频的历史指针交互不阻止新播放器接管；纯音频不受可见面积限制。实际选择变化通过唯一 `selected` 通知同步 Background。
- **观察与恢复边界**: `volumechange`、`ratechange`、`seeked` 即使由浏览器标记为 trusted，也可能来自网页脚本，不能据此切换控制目标。恢复已确认的音量/速度只作用于当前选中媒体；后台预加载元素的恢复 ACK 不得夺取当前目标。
- `activeMedia` 与 `activeVideo` 独立关联，音频元素选择不清除视频目标。控制写入作用域限定为 top-level document only (`frameId: 0`)；Popup 的只读媒体发现会独立检查已授权 frame，但不会把子 frame 变成控制目标。

### §13.1 Document-level inventory

Popup 枚举使用 `tabId + document generation` 隔离在途探测，并在一次轻量
`chrome.scripting.executeScript({ allFrames: true })` 前后核对 Chrome
`frameId + documentId` census。成功的 `found` 或所有当前 frame 均成功返回的
`no-media` 才是确定事实；权限拒绝、导航错代、无效响应和超时分别投影为
`denied/stale/unknown/pending`，同时返回 examined/failed coverage。
非 `http/https/file` 的标签页（扩展内部页、`chrome://` 等）不可承载可控媒体，
从可见集剔除且不计入 coverage 的 total/denied，其存在不得把完整 inventory 降级
为 degraded。

同一 v2 envelope 的新增证据保持 additive：当前 producer 必须发送单调
`reportRevision` 和完整 coverage。旧 content report 缺少 revision 时，Background
只确认收到，不能创建或覆盖有序媒体事实；只含 `tabs` 的旧 inventory 响应在新 UI
中映射为 `unknown`，不能签发 complete。轻量 DOM census 负责重新获得当前事实。

探测不加载重级 Content runtime。底层 Chrome Promise 未结束时仍占据物理许可；
重复打开 Popup 只观察同一文档操作。候选起点跨扫描轮转；当所有许可都被永久
占用时，系统明确返回 degraded，不能通过逻辑超时释放许可或伪造无媒体。

### §13.2 Edge Case & ACK Projection Table

| Edge | Required result | Owner and purpose |
| --- | --- | --- |
| 重复 `load()` 同 URL | `emptied`/`loadstart` 递增 `sourceRevision`；`loadedmetadata` 闭合 epoch | `MediaRegistry::refreshSource`（防状态泄露） |
| `srcObject` 替换 | 相同 URL 下不同流递增 `sourceRevision` | `MediaRegistry::sourceIdentity` |
| 框架节点重排 | `isConnected === false` 时在微任务确认销毁 | `MediaRegistry::queueRemovalTree` |
| SPA 预渲染 Modal | 注册时同步记录可见面积，仅成为当前目标后重放设置 | `MediaRegistry::register` / `NativeMediaExecutor::replayDesired` |
| 镜像快照读取 | `peek`/`resolve` 保持纯净；显式选择或自动播放候选胜出才切换 | `MediaRegistry::selectRecord` |
| 全屏播放器容器 | 精确媒体匹配优先，否则显式全屏视频优先 | `MediaRegistry::fullscreenRecord` |

| Contract scope | `activeMedia` projection | `activeVideo` projection |
| --- | --- | --- |
| `active-media`, `media-source`, `requested-audio-scope` | 替换为实际 ACK 目标 | 仅当目标为视频时同步替换 |
| `active-video` | 保持原状 | 替换为实际视频 ACK 目标 |
| `tab`, `document`, `extension-ui`, `sandbox` | 保持原状 | 保持原状 |

## §14 Media controls

### Physical readback and autoplay admission

倍速 actual 始终来自精确媒体的 `playbackRate`；页面控制器 getter 是写入证人，
不能单独签发成功。page speed 写入在有界稳定窗内同时验证 controller 与 DOM；
允许异步追上，永久不一致则按能力失败处理。冷态 bootstrap、完整 runtime 和释放
后的观察都以 `dom-native` 归因实际倍速，写入归因仍保留实际 page/DOM writer。

声明注册表的 `projection.optionSelector` 是 page speed 的数值准入边界：只读取
精确播放器根内、唯一媒体对应的可用档位，文本解析与独立菜单证人共用同一函数。
未列出、菜单未挂载或无法唯一关联时，直接由既有 DOM writer 同步写入实际倍速；
不先试网页 setter，不等待能力超时，不先写其它速率，也不写乐观标签。该无页面
写入的证明允许精确旧 ownership 交接并保留原物理 baseline。后续档位真实挂载时
可重新准入；通用连续控制器保留既有发现与稳定确认语义。

已准入的页面控制器仍不能承接请求值时，分别保留尝试前的 controller 与 physical baseline；先经
原 page writer 证明其自身基线已恢复，再由既有 DOM writer 恢复物理基线，才应用
新的 DOM speed。不得要求页面支持此前由 DOM 承接的自由值。已持有的 page speed
也可按此证明交接；保留
原始 baseline 与旧 ownership 的精确身份。终止性的激活、安全和生命周期错误
不得以 DOM 绕过。每源只记住最近一次**实际 page 写入失败**的数值，避免对同值
显式或自动反复升级；菜单仍有该档位也不能覆盖已证明的物理拒绝。未试写的数值
不计入失败 memo；不同数值仍按准入规则探测，源退休时清除。音量/静音不因该
speed 交接扩大降级权限。

取消静音必须在公共原生写入入口、page/DOM 分支之前检查文档激活。尚未真实交互
的文档不得把媒体从 muted 改为 unmuted；返回 `user-activation-required`，保留真实
静音与播放状态，不调用 `play()` 补偿。mute、已取消静音的幂等读回、以及其它音量
或倍速恢复独立处理。自动重放跳过仍被该边界拒绝的 unmute；后续显式操作重新
检查激活，退出和回滚同样经过唯一入口。

### Actual speed label

声明站点的工具栏倍速文字由 isolated bootstrap 的
`createSiteSpeedLabelProjection` 唯一投影，事实源是同一声明播放器根内唯一媒体的
`playbackRate`。首次 DOM ready、暖注入、pageshow 主动读回；媒体生命周期和
`ratechange` 同步真实数值。仅观察已发现的播放器根，覆盖标签晚挂载和 React
重渲染；不观察整个文档，不写媒体/控制器，不依赖重级 runtime、菜单展开或档位
存在。`1x` 也必须显示数值；`1.3x` 等未列出的速率直接显示，不夹取最近选项。

注册表 `projection.labelSelector` 只指定专属文本节点，`rootSelector` 限定绑定。
多个根独立同步，同根多个媒体时拒绝猜测。保留 React 文本节点与其它控件；
bootstrap dispose 断开观察并仅恢复仍由本写者持有的文本。菜单选中项仍是独立的
页面控制器证人，扩展写出的标签不得用来签发 controller ACK。

修复证据与验证进度见 [toolbar 同步记录](../../../../docs/research/2026-11-01-spectra-speed-toolbar-sync.md)。

| Field | Preferred implementation | Escalation |
| --- | --- | --- |
| speed | 精确元素控制器 getter/setter -> DOM `playbackRate` | 拒绝/限幅则还原 baseline 后降级 DOM |
| preserve pitch | `preservesPitch` 属性读回 | 无属性时为 unsupported |
| play/pause | `play()` / `pause` 事件 | 失败报错，严禁绕过自动播放限制 |
| seek | `TimeRanges` + `seeked` 读回 | 无时间轴时为 unsupported |
| frame step | `requestVideoFrameCallback` / 原生 seek | 必须标记 `approximate:true` |
| loop | `media.loop` | unsupported |
| PiP / Fullscreen | 原生 PiP / Fullscreen API | 失败报错，需真实 user activation |

A/B State 与 Marker 均以 `mediaId + sourceRevision` 为 Key。禁用后清理所有 Timer/rAF/Listener。

## §15 Video effects and screenshot

- **Rotate / Mirror**: 使用扩展属性控制独立 CSS `rotate`/`scale`（不覆盖站点 `transform`）。
- **Fill**: 扩展 `object-fit:cover` 规则（禁用移除属性）。
- **Filter**: 捕获 computed baseline 组合扩展 Filter（禁用恢复原始 Cascade）。
- **Dim**: 闭合 Shadow Host 内 4 个固定 Overlay（不改变视频 `position`/`z-index`）。
- **Screenshot**: 校验视频可见性与帧，调用 `captureVisibleTab` 在 Background 裁剪，等待 Chrome 下载 `complete` ACK 后返回元数据（禁止通过 IPC 传输图像字节）。
