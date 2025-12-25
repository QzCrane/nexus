# CORS 数据流

**原理**: 跨域不报错，但 AnalyserNode 返回全零。

## 检测序列

1. 查表 → 命中用缓存 / 否则 PENDING
2. 页面加载 5s 内轮询媒体元素
3. 观察模式 (6s): 有数据 →SAFE / 超时 →RESTRICTED
4. 结果 → REGISTRY_MARK_PROBED 持久化 → applyState()
5. SPA: 路径变化 → probeCors()

## 职责

- cors-handler.ts: internalState 读写
- cors-prober.ts: WebAudio 探测执行
- navigation-observer.ts: SPA 导航重测

## 决策规则

isRestricted = (corsStatus !== 'SAFE')

!needsAdvanced → LITE (🔵)
!isRestricted → WEB (🔵)
其他 → CAPTURE (🟣)
