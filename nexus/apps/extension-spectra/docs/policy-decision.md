# Extension SPECTRA 策略决策表

> 此文档详细描述 PolicyEngine 的决策逻辑，从 `.ai-context.md` 分离以保持简洁。

## 核心原则

> 最大化使用原生模式 (省 CPU)，只有控制不了或有高级需求时才劫持

## 高级需求定义

以下任一条件满足即视为"有高级需求"：

```typescript
function needsAdvancedProcessing(
  config: AudioConfig,
  visualizerEnabled: boolean
): boolean {
  return (
    config.volume > 100 || // 音量超过 100%
    visualizerEnabled || // 频谱可视化开启
    config.eqValues.some((v) => v !== 0) || // EQ 非默认
    config.compressor || // 压缩器开启
    config.bass // 低音增强开启
  );
}
```

## 模式说明

| 模式     | 标识              | 说明                           | CPU 消耗 |
| -------- | ----------------- | ------------------------------ | -------- |
| 原生精简 | `NATIVE_LITE`     | 仅 DOM 音量控制 (0-100%)       | 极低     |
| 原生完整 | `NATIVE_WEBAUDIO` | WebAudio 处理链 (EQ/压缩/频谱) | 中       |
| 劫持模式 | `CAPTURE`         | Tab Capture 整页音频劫持       | 高       |

## 完整决策表

| 序号 | 页面类型 | 高级需求 | 受限站点 | 用户已操作 |     决策模式      | 颜色  |
| :--: | :------: | :------: | :------: | :--------: | :---------------: | :---: |
|  1   |   任意   |  ❌ 否   |   任意   |    任意    |   `NATIVE_LITE`   | 🔵 蓝 |
|  2   |  播放页  |  ✅ 是   |  ❌ 否   |     -      | `NATIVE_WEBAUDIO` | 🔵 蓝 |
|  3   |  播放页  |  ✅ 是   |  ✅ 是   |     -      |     `CAPTURE`     | 🟣 紫 |
|  4   |  预览页  |  ✅ 是   |  ❌ 否   |   ❌ 否    | `NATIVE_WEBAUDIO` | 🔵 蓝 |
|  5   |  预览页  |  ✅ 是   |  ❌ 否   |   ✅ 是    | `NATIVE_WEBAUDIO` | 🔵 蓝 |
|  6   |  预览页  |  ✅ 是   |  ✅ 是   |   ❌ 否    |   `NATIVE_LITE`   | 🔵 蓝 |
|  7   |  预览页  |  ✅ 是   |  ✅ 是   |   ✅ 是    |     `CAPTURE`     | 🟣 紫 |

## 播放页判定

**简化架构 (v24.1)**：优先通用规则，站点规则仅保留受限列表和直播子域名

**检测优先级**（从高到低）：

1. **视频参数**：`modal_id`/`v`/`bvid`/`video_id` 等 → 绝对播放页
2. **通用路径**：`/video/`/`/watch`/`/play/`/`/live/` 等 → 高概率播放页
3. **Hash 关键词**：`#video`/`#play` 等 → 可能播放页
4. **直播子域名**：`live.xxx.com` → 整站播放页
5. **预览页排除**：明确的搜索/推荐页面最后过滤

**站点规则仅用于**：

- 受限站点列表（CORS 限制，无法从 URL 推断）
- 直播子域名（`live.douyin.com` 等）

## 决策流程图

```text
                  ┌─────────────────┐
                  │  有高级需求?     │
                  └────────┬────────┘
                           │
            ┌──────────────┴──────────────┐
           ❌ 否                         ✅ 是
            ↓                              ↓
      NATIVE_LITE              ┌──────────────────┐
       (最省CPU)               │   是否受限站点?   │
                               └────────┬─────────┘
                            ┌───────────┴───────────┐
                          ❌ 否                   ✅ 是
                            ↓                       ↓
                    NATIVE_WEBAUDIO          ┌───────────────┐
                                             │ 是否播放页?    │
                                             └───────┬───────┘
                                          ┌──────────┴─────────┐
                                        ✅ 是                ❌ 否 (预览页)
                                          ↓                     ↓
                                      CAPTURE           ┌───────────────┐
                                                        │ 用户已操作?   │
                                                        └───────┬───────┘
                                                     ┌──────────┴──────────┐
                                                   ❌ 否                 ✅ 是
                                                     ↓                     ↓
                                               NATIVE_LITE             CAPTURE
```

## 实现位置

- **PolicyEngine**: `packages/features/audio-engine/src/PolicyEngine.ts`
- **契约定义**: `packages/contracts/src/audio.contracts.ts`
