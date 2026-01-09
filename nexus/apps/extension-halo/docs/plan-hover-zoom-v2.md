# Hover Zoom 2.0 规划 - 超越 HZ+

> 目标: 比 HZ+ 更优(功能/性能/维护性) | 基于 HZ+ 4792 行 + 396 plugins 深度分析

## HZ+ 架构分析

**核心文件** (2.1MB 总大小):

- `hoverzoom.js`: 4792 行 单体架构 | jQuery 依赖 | 全局状态
- `hls.js`: 1MB HLS 播放库
- `plugins/`: 396 个站点规则文件 (各 300-48000 行)
- `background.js`: API 代理 (CORB 绕过)

**HZ+ 问题**:

1. **巨型单体**: 4792 行单文件 → 难维护/难测试
2. **jQuery 依赖**: 296KB 冗余 + 不兼容现代框架
3. **全局污染**: `hoverZoomPlugins` 数组注入 window
4. **同步插件加载**: 396 插件全量加载 → 慢启动
5. **无类型**: 纯 JS → IDE 无提示/运行时错误
6. **样式内联**: CSS 硬编码 JS → 无法复用

**HZ+ 优势** (必须借鉴):

1. **丰富详情**: dimensions/ratio/scale/duration/host/filename/contentLength/lastModified
2. **Video+Audio 分离播放**: `.video` + `.audio` URL 标记 → MSE 合成
3. **Gallery 模式**: 左右键切换多图
4. **fallback 链**: 多源 URL 失败自动尝试下一个
5. **HLS/DASH 支持**: hls.js 集成
6. **Ambilight 环境光**: canvas 抽取颜色渲染背景

---

## Halo HoverZoom 2.0 路线图

### Phase 1: 信息栏完善 ✅ (已完成)

- [x] 7 项 info bar (typeIcon/dims/format/size/caption/source/hostname)
- [x] 各项独立开关
- [x] i18n 支持

### Phase 2: 详情增强 (Q1 W2)

**目标**: 超越 HZ+ 的 displayDetails()

| 信息项        | HZ+ 有 | Halo 状态 | 优先级 |
| ------------- | ------ | --------- | ------ |
| dimensions    | ✅     | ✅        | -      |
| ratio         | ✅     | ❌        | P1     |
| scale         | ✅     | ❌        | P1     |
| duration      | ✅     | ❌        | P2     |
| filename      | ✅     | ❌        | P2     |
| contentLength | ✅     | ✅ (size) | -      |
| lastModified  | ✅     | ❌        | P3     |
| aspectRatio   | ❌     | 新增      | P2     |

**实现**: 扩展 `EnhancedResult` + `info.ts` 渲染

### Phase 3: 视频播放 (Q1 W3-4)

**目标**: 真正播放视频 (非仅封面)

**策略对比**:
| 方案 | 复杂度 | 体积 | 兼容性 |
|-----|-------|-----|-------|
| A. 直链 mp4/webm | 低 | 0 | 仅常规格式 |
| B. 站点 API | 中 | 0 | 需逐站适配 |
| C. hls.js | 高 | +1MB | HLS 全兼容 |
| D. shaka-player | 高 | +300KB | DASH+HLS |

**推荐**: B → A fallback → D (按需加载 shaka)

**B 站实现** (参考 HZ+ bilibili_a.js):

```
1. 检测 /video/BV* 链接
2. 获取 cid+bvid (页面 __INITIAL_STATE__ 或 API)
3. 调用 https://api.bilibili.com/x/player/playurl
4. 提取 dash.video[0].baseUrl + dash.audio[0].baseUrl
5. MSE 合成 video+audio 流
```

**架构**:

- `video-loader.ts`: 站点适配器接口
- `adapters/bilibili.ts`: B 站适配器
- `mse-player.ts`: MediaSource 合成播放

### Phase 4: Gallery 模式 (Q1 W5)

**功能**:

- ← → 键切换图集
- 指示器 "3/12"
- 预加载相邻图

**数据结构**: `EnhancedResult.gallery?: string[]`

### Phase 5: 高级功能 (Q2)

| 功能        | 说明                       | 优先级 |
| ----------- | -------------------------- | ------ |
| Ambilight   | 环境光背景 (canvas 提取色) | P2     |
| Fallback 链 | 多源 URL 自动切换          | P1     |
| 锁定模式    | 点击固定 viewer            | P2     |
| 缩放平移    | 滚轮缩放 + 拖动            | P1     |
| 旋转/翻转   | R 键旋转 F 键翻转          | P3     |
| 下载命名    | 模板: `<host>/<filename>`  | P3     |

---

## 架构优势 (vs HZ+)

| 维度     | HZ+              | Halo HoverZoom      |
| -------- | ---------------- | ------------------- |
| **语言** | JS               | TypeScript          |
| **依赖** | jQuery 296KB     | 零依赖              |
| **结构** | 单文件 4792 行   | 模块化 ≤200 行/文件 |
| **规则** | 396 独立 plugins | RuleEngine 统一注册 |
| **加载** | 全量同步         | 按需懒加载          |
| **样式** | 内联 JS          | 独立 CSS + CSS 变量 |
| **类型** | 无               | 完整 TS 类型        |
| **测试** | 无               | Playwright 集成     |

---

## 下一步行动

2. **Phase 2** 实现 ratio/scale/duration 详情
3. **Phase 3** B 站视频播放适配器