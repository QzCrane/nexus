# 策略引擎重构计划 V2

> **目标**：简化音频模式决策逻辑，优化 UI 显示规则，完善站点规则

## 一、核心改动概述

### 1.1 策略简化 (P0)

**现状问题**：

- `NATIVE_LITE` 与 `NATIVE_WEBAUDIO` 区分不够清晰
- 用户核心需求：**最大化利用原生模式 (省 CPU)，只有控制不了时才劫持**

**新策略原则**：

```text
无高级需求 → NATIVE_LITE (最省 CPU)
有高级需求 + 非受限 → NATIVE_WEBAUDIO
有高级需求 + 受限 + 播放页 → CAPTURE
有高级需求 + 受限 + 预览页 + 用户未操作 → NATIVE_LITE
有高级需求 + 受限 + 预览页 + 用户已操作 → CAPTURE
```

**"高级需求"定义**（任一满足即为真）：

```typescript
function needsAdvancedProcessing(config: AudioConfig, visualizerEnabled: boolean): boolean {
  return (
    config.volume > 100 ||                    // 音量超过 100%
    visualizerEnabled ||                      // 频谱可视化开启
    config.eqValues.some(v => v !== 0) ||     // EQ 非默认值
    config.compressor ||                      // 压缩器开启
    config.bass                               // 低音增强开启
  );
}
```

**完整决策表**：

| 序号 | 页面类型 | 高级需求 | 受限站点 | 用户已操作 | 决策模式 | 颜色 |
|:----:|:--------:|:--------:|:--------:|:----------:|:--------:|:----:|
| 1 | 任意 | ❌ 否 | 任意 | 任意 | `NATIVE_LITE` | 🔵 蓝 |
| 2 | 播放页 | ✅ 是 | ❌ 否 | - | `NATIVE_WEBAUDIO` | 🔵 蓝 |
| 3 | 播放页 | ✅ 是 | ✅ 是 | - | `CAPTURE` | 🟣 紫 |
| 4 | 预览页 | ✅ 是 | ❌ 否 | ❌ 否 | `NATIVE_WEBAUDIO` | 🔵 蓝 |
| 5 | 预览页 | ✅ 是 | ❌ 否 | ✅ 是 | `NATIVE_WEBAUDIO` | 🔵 蓝 |
| 6 | 预览页 | ✅ 是 | ✅ 是 | ❌ 否 | `NATIVE_LITE` | 🔵 蓝 |
| 7 | 预览页 | ✅ 是 | ✅ 是 | ✅ 是 | `CAPTURE` | 🟣 紫 |

### 1.2 UI 显示规则 (P1)

**现状问题**：

- 后台标签页会闪现然后消失
- 没有 60 秒暂停后移除机制
- 无音频信号提示在有后台音频时也显示

**新规则**：

| 区域 | 显示条件 |
|------|---------|
| 主卡片 | 当前活动标签页 且 有媒体元素 |
| 后台卡片 | 曾被激活 且 (正在发声 或 60s 内发过声) |
| 空状态 | 主卡片 + 后台卡片 = 0 时才显示 |

### 1.3 站点规则完善 (P2)

**现状问题**：

- 只有 B站/YTB 有预览页规则
- 其他站点缺失预览页定义

**改进**：合并 `DefaultSiteRules` + `DefaultPreviewRules` 为统一结构

---

## 二、实施步骤

### Phase 1: 策略引擎重构 (P0) ✅ 已完成

**涉及文件**：

- `packages/features/audio-engine/src/PolicyEngine.ts`
- `packages/features/audio-engine/src/constants.ts`
- `packages/contracts/src/audio.contracts.ts`
- `apps/extension-spectra/src/content/policy-executor.ts`

**步骤**：

1. ✅ **[audio-engine]** 新增 `needsAdvancedProcessing` 辅助函数
2. ✅ **[audio-engine]** 重写 `PolicyEngine.calculateMode` 使用 V2 简化策略
3. ✅ **[contracts]** 更新 `PolicyContext` 添加 `config?: AudioConfig` 字段
4. ✅ **[extension]** 更新 `policy-executor.ts` 传递完整 config

### Phase 2: Tab 状态管理 (P1) ✅ 已完成

**涉及文件**：

- `apps/extension-spectra/src/background/state.ts` (新增 TabAudioState)
- `apps/extension-spectra/src/background/lifecycle.ts` (监听事件)
- `apps/extension-spectra/src/background/handlers/tab-state.ts` (新增)
- `apps/extension-spectra/src/content/index.ts` (上报 hasMediaElement)
- `apps/extension-spectra/src/popup/index.ts` (查询可显示标签页)

**新增类型**：

```typescript
interface TabAudioState {
  hasMediaElement: boolean;   // 页面有 audio/video 元素
  lastAudibleTime: number;    // 最后发声时间戳
  lastActivatedTime: number;  // 用户最后切换到该标签页时间
}
```

**步骤**：

1. ✅ **[contracts]** 新增 `TAB_REPORT_MEDIA` + `TAB_GET_VISIBLE_TABS` 消息类型
2. ✅ **[background/state.ts]** 新增 `tabAudioStates: Map<number, TabAudioState>`
3. ✅ **[background/lifecycle.ts]** 监听:
   - `chrome.tabs.onActivated` → 更新 `lastActivatedTime`
   - `chrome.tabs.onUpdated` (audible 变化) → 更新 `lastAudibleTime`
4. ✅ **[background/handlers/tab-state.ts]** 新增路由:
   - `TAB_REPORT_MEDIA` → 更新 state
   - `TAB_GET_VISIBLE_TABS` → 返回符合条件的 tabId[]
5. ✅ **[content/index.ts]** 启动时上报 `TAB_REPORT_MEDIA` + 定期上报
6. ✅ **[popup/index.ts]** 改为查询 `TAB_GET_VISIBLE_TABS` (含降级逻辑)

### Phase 3: 站点规则合并 (P2) ✅ 已完成

**涉及文件**：

- `packages/features/audio-engine/src/constants.ts`

**新结构**：

```typescript
export interface CompleteSiteRule {
  name: string;
  hostPattern: string;
  isRestricted?: boolean;      // 是否为受限站点 (CORS)
  playPaths?: readonly string[];
  playPathRegex?: readonly RegExp[];
  previewPaths?: readonly string[];
  previewSubdomains?: readonly string[];
  liveSubdomains?: readonly string[];
}
```

**新增站点 (共 12 个)**：

| 站点 | 受限 | 备注 |
|------|:----:|------|
| 抖音 | ✅ | 含直播子域名 |
| YouTube | ❌ | 非受限 |
| Bilibili | ❌ | 非受限 |
| Netflix | ✅ | - |
| TikTok | ✅ | - |
| Spotify | ✅ | - |
| 腾讯视频 | ✅ | 新增 |
| 爱奇艺 | ✅ | 新增 |
| 优酷 | ✅ | 新增 |
| 芒果TV | ✅ | 新增 |
| Twitch | ❌ | 新增 (非受限) |
| 西瓜视频 | ✅ | 新增 |

---

## 三、消息协议变更

| Action | 请求 | 响应 | 说明 |
|--------|-----|------|------|
| `TAB_REPORT_MEDIA` | `{ hasMediaElement: boolean }` | void | Content → Background |
| `TAB_GET_VISIBLE_TABS` | void | `{ tabs: number[] }` | Popup → Background |

---

## 四、测试检查点

- [ ] B站播放页：音量 100%、频谱关 → 应为 NATIVE_LITE (🔵)
- [ ] B站播放页：音量 150% → 应为 NATIVE_WEBAUDIO (🔵)
- [ ] 抖音首页：音量 100%、频谱关 → 应为 NATIVE_LITE (🔵)
- [ ] 抖音首页：音量 150% → 应为 CAPTURE (🟣)
- [ ] 暂停视频等待 60 秒后：后台卡片应消失

---

## 五、回滚策略

所有改动均为向后兼容，若出现问题可通过以下方式回滚：

1. `PolicyEngine.calculateMode` 保留原逻辑分支
2. `TAB_GET_VISIBLE_TABS` 失败时 fallback 到原有 `chrome.tabs.query`
