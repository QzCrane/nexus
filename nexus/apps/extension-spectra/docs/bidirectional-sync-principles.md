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
setTimeout(() => {
  s.settingByPlugin = false;
}, 100);

// 事件监听中检查
media.addEventListener("volumechange", () => {
  if (s.settingByPlugin) return; // 跳过插件触发的
  onNativeVolumeChange(volume); // 只响应用户操作
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

### 5. 站点网桥特化 (SiteBridge)

**前提**: 强侵入站点 (如 YouTube) 必须通过 `SiteBridge` 权威通信。

- **API 优先**: `shouldInhibitDomSync() === true` 时，核心绝禁直改 DOM。
- **权威回流 (Authoritative Sync)**: 网桥监听原生事件(如 `onVolumeChange`)作为唯一真值回传。
- **防御性同步 (Sync Guards)**:
  - **Boost Guard**: 强屏蔽官方 100% 音量上报，死守插件侧 >100% 增益。
  - **Speed Guard**: 强屏蔽 SPA 导航引起的 1.0x 速率重置覆盖。

## 实现架构

### 模块职责

- VolumeObserver (`audio/volume-observer.ts`): 侦听器 | 检测原生用户变动
- DOMVolume (`audio/dom-volume.ts`): 执行器 | 应用配置至 DOM
- SiteBridge (`logic/site-bridge/*`): 网桥 | 权威接口代理 (YouTube 等)

### 数据流

```
┌─────────────┐     volumechange      ┌──────────────┐
│  页面媒体    │ ─────────────────────→ │ VolumeObserver│
│  (video)    │                        │ (检测用户操作) │
└─────────────┘                        └──────┬───────┘
       ↑                                      │
       │ [ModeExecutor]                       │ onNativeVolumeChange
       │ setDomVolume()                       ▼
┌──────┴──────┐      syncVolume()      ┌──────────────┐
│  DOMVolume  │ ←───────────────────── │ PolicyExecutor│
│ (应用配置)   │ ─────────────────────→ │ (更新配置)    │
└─────────────┘      [SiteBridge]      └──────────────┘
                     (YouTube 权威同步)
```

## 关键规则

1. **事件监听优于 Setter Hijack**：使用 `volumechange`/`ratechange` 事件而非劫持原型链 setter
2. **标志位清理必须异步**：`setTimeout(() => s.settingByPlugin = false, 100)`
3. **阈值判断避免抖动**：`Math.abs(vol - target) > 0.005`
4. **YouTube 双通道同步**：DOM 操作 + YouTube API 调用

## 常见错误防范

- **禁 WeakSet**: 无法重复应用 → 必须用 `settingByPlugin` 标志位
- **禁 Setter Hijack**: 漏掉底层的变动 → 必须用原生 `volumechange` 事件
- **禁同步清理**: 会误杀后续事件流 → 强制 `setTimeout(..., 100)` 异步放开锁
- **禁无阈值**: 引发无限循环抖动 → 必须过滤 `Math.abs(vol - target) < 0.005`

## 测试验证点

1. 页面刷新后音量/速度保持
2. 页面 UI 修改同步到插件
3. 插件修改同步到页面
4. 无循环更新（不抖动）
5. YouTube 音量条同步
6. 新打开页面应用域名配置
