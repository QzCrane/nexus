# CORS 数据流

**判定核心**：跨域不报错，但 `AnalyserNode` 返回全零。

## 检测流程

1. **初始化**: 查表命中则用缓存，否则标记 `PENDING`。
2. **主动探测**: 页面加载后 5s 内轮询媒体元素。
3. **观察模式**:
   - 播放中观察 6s Analyser 数据。
   - 有数据 → `SAFE`；超时无数据 → `RESTRICTED`。
   - 结果通过 `REGISTRY_MARK_PROBED` 持久化，并触发 `applyState`。
4. **SPA 适配**: 监听路径变化，触发 `probeCors()`。

## 职责划分

- **cors-handler**: 控制 `internalState` 读写。
- **cors-checker**: 执行 WebAudio 探测。
- **navigation**: 触发 SPA 导航重测。

## 决策逻辑

`isRestricted = (corsStatus !== 'SAFE')`

- `!needsAdvanced` → **LITE** (🔵)
- `!isRestricted` → **WEB** (🔵)
- 其他情况 → **CAPTURE** (🟣)
