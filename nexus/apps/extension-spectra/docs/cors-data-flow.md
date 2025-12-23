# CORS 数据流 (v3.4)

## 检测流程

```text
页面加载 → initCorsStatus() 查表
  ├─ 在表中 (probed=true) → 直接使用结果
  └─ 不在表中 → corsStatus = PENDING
                     │
                     ▼
           probeCorsOnMediaDetected()
           发现媒体元素 (readyState>=2 且正在播放)
                     │
                     ▼
           probeWithTempContext()
           创建临时 AudioContext + AnalyserNode
           读取 getByteFrequencyData()
                     │
                     ├─ 有数据 → SAFE
                     └─ 全零 → RESTRICTED (CORS 限制)
                              │
                              ▼
           internalState.corsStatus 更新
           REGISTRY_MARK_PROBED 持久化
           applyState() 触发模式重计算
```

## 关键原理

**`createMediaElementSource()` 不会因跨域抛出错误！**

CORS 限制仅在读取音频数据时体现：`AnalyserNode.getByteFrequencyData()` 返回全零

## 职责

| 组件            | 写/读 | 数据                       |
| --------------- | ----- | -------------------------- |
| cors-handler    | 写    | `internalState.corsStatus` |
| cors-prober     | 探测  | AnalyserNode 数据检测      |
| policy-executor | 读    | → `context.isRestricted`   |
| badge-sync      | 读    | → 角标颜色                 |

## 决策

```text
needsAdvanced = volume>100 || visualizer || EQ || compressor || bass
isRestricted = corsStatus !== 'SAFE'  // PENDING 保守视为受限

!needsAdvanced → NATIVE_LITE (蓝)
!isRestricted  → NATIVE_WEBAUDIO (蓝)
else           → CAPTURE (紫)
```

## 持久化

`REGISTRY_MARK_PROBED` → `chrome.storage.restrictedRegistry` → 下次 `initCorsStatus()` 读取
