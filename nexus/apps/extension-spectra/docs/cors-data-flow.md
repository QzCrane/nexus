# CORS 数据流 (v3.3)

## 检测流程

```text
页面加载 → initCorsStatus() 查表
  ├─ 在表中 (probed=true) → 直接使用结果
  └─ 不在表中 → corsStatus = PENDING
                     │
                     ▼
           probeCorsOnMediaDetected()
           发现媒体元素 → probeWithTempContext()
                     │ 临时 AudioContext 探测
                     ▼
           corsStatus = SAFE/RESTRICTED
           REGISTRY_MARK_PROBED 持久化

WebAudioController.attachNode() 也可更新 corsStatus
```

## 职责

| 组件            | 写/读 | 数据                       |
| --------------- | ----- | -------------------------- |
| cors-handler    | 写    | `internalState.corsStatus` |
| cors-prober     | 探测  | 临时 AudioContext 测试     |
| policy-executor | 读    | → `context.isRestricted`   |
| badge-sync      | 读    | → 角标颜色                 |
| popup/messaging | 读    | → `state.isRestrictedSite` |

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
