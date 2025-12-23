# CORS 数据流 (v3.2)

## 流程

```text
WebAudioController.attachNode()
    │ 成功/失败
    ▼
cors-handler → internalState.corsStatus (PENDING/SAFE/RESTRICTED)
    │ 读取
    ▼
PolicyEngine.calculateMode(context.isRestricted)
    │
    ├─► badge-sync → BADGE_UPDATE
    └─► broadcastUI → UI_SYNC { isRestricted }
                           │
                           ▼
                      Popup: state.isRestrictedSite
```

## 职责

| 组件            | 写/读 | 数据                       |
| --------------- | ----- | -------------------------- |
| cors-handler    | 写    | `internalState.corsStatus` |
| policy-executor | 读    | → `context.isRestricted`   |
| badge-sync      | 读    | → 角标颜色                 |
| config-updater  | 读    | → OSD 颜色                 |
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

`REGISTRY_MARK_PROBED` → `chrome.storage.restrictedRegistry` → `initCorsStatus()` 下次读取
