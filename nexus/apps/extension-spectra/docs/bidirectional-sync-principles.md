# 双向同步业务原则

> 音量和速度双向同步的核心业务逻辑规范

## 核心原则

### 1. 单向传播原则

```
用户操作页面 UI → 检测变化 → 同步到插件 → 广播更新
插件修改配置 → 应用到页面 → 不触发回调
```

**禁止循环**：插件应用到页面时，必须防止事件回调重新触发插件更新。

### 2. 来源区分机制

使用 `settingByPlugin` 标志位区分修改来源：

```typescript
// 插件设置前标记
s.settingByPlugin = true;
media.volume = newVolume;
setTimeout(() => { s.settingByPlugin = false; }, 100);

// 事件监听中检查
media.addEventListener('volumechange', () => {
    if (s.settingByPlugin) return; // 跳过插件触发的
    onNativeVolumeChange(volume);   // 只响应用户操作
});
```

### 3. 首次加载应用

页面加载时，应用保存的配置到所有媒体元素：

```typescript
export function setDomVolume(vol: number, muted: boolean): void {
    // 应用到所有未初始化的媒体元素
    for (const m of mediaElements) {
        if (Math.abs(m.volume - vol) > 0.005) {
            s.settingByPlugin = true;
            m.volume = vol;
        }
    }
}
```

### 4. 懒更新策略

- **页面刷新/新页面**：应用保存的配置
- **用户操作后**：不再自动纠正，等待用户操作或插件修改
- **新媒体元素**：自动应用当前插件配置

### 5. YouTube 特殊处理

YouTube 使用自定义播放器，需要额外 API 调用同步 UI：

```typescript
if (isYouTube()) {
    setYouTubeVolume(vol, muted);  // 同步 YouTube 原生 UI
}
```

## 实现架构

### 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| VolumeObserver | `audio/volume-observer.ts` | 事件监听，检测用户操作 |
| DOMVolume | `audio/dom-volume.ts` | 应用插件配置到页面 |
| YouTubeAdapter | `adapters/youtube-adapter.ts` | YouTube 特殊 API 调用 |

### 数据流

```
┌─────────────┐     volumechange      ┌──────────────┐
│  页面媒体    │ ─────────────────────→ │ VolumeObserver│
│  (video)    │                        │ (检测用户操作) │
└─────────────┘                        └──────┬───────┘
       ↑                                      │
       │ settingByPlugin=true                 │ onNativeVolumeChange
       │                                      ▼
┌──────┴──────┐                        ┌──────────────┐
│  DOMVolume  │ ←───────────────────── │ PolicyExecutor│
│ (应用配置)   │    setDomVolume()      │ (更新配置)    │
└─────────────┘                        └──────────────┘
```

## 关键规则

1. **事件监听优于 Setter Hijack**：使用 `volumechange`/`ratechange` 事件而非劫持原型链 setter
2. **标志位清理必须异步**：`setTimeout(() => s.settingByPlugin = false, 100)`
3. **阈值判断避免抖动**：`Math.abs(vol - target) > 0.005`
4. **YouTube 双通道同步**：DOM 操作 + YouTube API 调用

## 常见错误

| 错误 | 后果 | 正确做法 |
|------|------|----------|
| 使用 WeakSet 标记 | 插件修改后无法再次应用 | 使用 settingByPlugin 标志位 |
| Setter Hijack | 原生音量为 1，无法检测 | 使用 volumechange 事件 |
| 同步清理标志位 | 事件可能在设置后触发 | 异步清理标志位 |
| 无阈值判断 | 频繁触发更新 | 0.005 阈值过滤 |

## 测试验证点

1. 页面刷新后音量/速度保持
2. 页面 UI 修改同步到插件
3. 插件修改同步到页面
4. 无循环更新（不抖动）
5. YouTube 音量条同步
6. 新打开页面应用域名配置
