---
type: reference
status: stable
audience: developer
last_reviewed: 2026-07-30
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

- **目标选择优先级**: `显式 mediaId -> 最新受信任交互 -> 最新播放 -> 当前播放中 -> 注册视口几何/可见性 -> 注册顺序`
- `activeMedia` 与 `activeVideo` 独立关联，音频元素选择不清除视频目标。当前作用域限定为 top-level document only (`frameId: 0`)。

### §13.1 Edge Case & ACK Projection Table

| Edge | Required result | Owner and purpose |
| --- | --- | --- |
| 重复 `load()` 同 URL | `emptied`/`loadstart` 递增 `sourceRevision`；`loadedmetadata` 闭合 epoch | `MediaRegistry::refreshSource`（防状态泄露） |
| `srcObject` 替换 | 相同 URL 下不同流递增 `sourceRevision` | `MediaRegistry::sourceIdentity` |
| 框架节点重排 | `isConnected === false` 时在微任务确认销毁 | `MediaRegistry::queueRemovalTree` |
| SPA 预渲染 Modal | 注册时同步记录可见面积并允许目标重放 | `MediaRegistry::register` |
| 镜像快照读取 | `peek`/`resolve` 保持纯净，仅 `select` 或原生事件改变选择 | `MediaRegistry::selectRecord` |
| 全屏播放器容器 | 精确媒体匹配优先，否则显式全屏视频优先 | `MediaRegistry::fullscreenRecord` |

| Contract scope | `activeMedia` projection | `activeVideo` projection |
| --- | --- | --- |
| `active-media`, `media-source`, `requested-audio-scope` | 替换为实际 ACK 目标 | 仅当目标为视频时同步替换 |
| `active-video` | 保持原状 | 替换为实际视频 ACK 目标 |
| `tab`, `document`, `extension-ui`, `sandbox` | 保持原状 | 保持原状 |

## §14 Media controls

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
