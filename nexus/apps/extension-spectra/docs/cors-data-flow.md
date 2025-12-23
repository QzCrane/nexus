# CORS 数据流 (v3.12)

## 检测流程

```text
页面加载 → initCorsStatus() 查表
  ├─ 在表中 (probed=true) → 直接使用结果
  └─ 不在表中 → corsStatus = PENDING
                     │
                     ▼
           tryStartCorsDetection() 主动探测
           延迟 500ms 开始，每秒检查媒体元素
           最多检查 5 次
                     │
                     ▼ (发现媒体元素)
           WebAudioController.attachNode()
           创建 AudioContext + AnalyserNode
                     │
                     ├─ 媒体暂停/静音 → 等待 play 事件
                     └─ 媒体播放中 → 观察模式 (6秒)
                               │
                               ├─ 有音频数据 → SAFE + Toast
                               └─ 超时无数据 → RESTRICTED + Toast
                                         │
                                         ▼
           internalState.corsStatus 更新
           REGISTRY_MARK_PROBED 持久化
           applyState() 触发模式重计算

SPA 导航 → navigation-observer 异步监听
  ├─ popstate (后退/前进)
  └─ pushState/replaceState (SPA 路由)
           │
           ▼
      路径变化 → probeCors() 重新检测
```

## 关键原理

**`createMediaElementSource()` 不会因跨域抛出错误！**

- 绑定成功 ≠ CORS 可用
- 真正判定在 `AnalyserNode.getByteFrequencyData()`
- 跨域限制时返回全零

## 职责

| 组件                | 写/读 | 数据                          |
| ------------------- | ----- | ----------------------------- |
| cors-handler        | 写    | `internalState.corsStatus`    |
| cors-checker        | 探测  | AnalyserNode 数据 + play 事件 |
| navigation-observer | 触发  | SPA 路径变化 → probeCors()    |
| policy-executor     | 读    | → `context.isRestricted`      |

## 决策

```text
needsAdvanced = volume>100 || visualizer || EQ || compressor || bass
isRestricted = corsStatus !== 'SAFE'  // PENDING 保守视为受限

!needsAdvanced → NATIVE_LITE (蓝)
!isRestricted  → NATIVE_WEBAUDIO (蓝)
else           → CAPTURE (紫)
```

## v3.12 改进

- 主动探测：页面加载后自动检查媒体元素
- 重试机制：最多 5 次检查，每次间隔 1 秒
- Toast 保证：所有入库操作均有 Toast 提示
- 误判更正：SAFE 可覆盖 RESTRICTED
