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

- [x] 9 项 info bar (typeIcon/dims/ratio/scale/format/size/caption/source/hostname)
- [x] 各项独立开关
- [x] i18n 支持

### Phase 2: 详情增强 ✅ (已完成)

**目标**: 超越 HZ+ 的 displayDetails()

| 信息项        | HZ+ 有 | Halo 状态 | 优先级 |
| ------------- | ------ | --------- | ------ |
| dimensions    | ✅     | ✅        | -      |
| ratio         | ✅     | ✅        | P1 ✅  |
| scale         | ✅     | ✅        | P1 ✅  |
| duration      | ✅     | ❌        | P3     |
| filename      | ✅     | ❌        | P3     |
| contentLength | ✅     | ✅ (size) | -      |
| lastModified  | ✅     | ❌        | P3     |

**实现**: `info.ts` - `calcRatio()` (GCD 简化) + `calcScale()` (显示/原始百分比)

### Phase 3: 视频播放 ✅ (已完成)

**目标**: 真正播放视频 (非仅封面)

**实现方案**:

- ✅ **B 站规则** (`rules/definitions/bilibili.ts`): 已实现 API 调用获取 DASH 流
- ✅ **MSE 播放器** (`viewer/mse-player.ts`): 合成 video+audio m4s 流
- ✅ **视频保护** (`image-resolver.ts`): 跳过正在播放的视频 (!paused)
- ✅ **media-display.ts**: 集成 MSE 播放，DASH 流自动处理

**架构**:

- `rules/definitions/bilibili.ts`: B 站 API 适配 (6 条规则)
- `viewer/mse-player.ts`: MediaSource Extensions 播放器 (+6KB)
- `viewer/media-display.ts`: 集成 MSE 或回退到缩略图

### Phase 4: Gallery 模式 (待实现)

**功能**:

- ← → 键切换图集
- 指示器 "3/12"
- 预加载相邻图

**数据结构**: `EnhancedResult.gallery?: string[]`

### Phase 5: Bilibili 弹幕 (新增规划)

**详细规划**: 见 `plan-danmaku.md`

**核心架构**:

- `danmaku/proto-decoder.ts`: Protobuf 手动解码 (无依赖)
- `danmaku/canvas-renderer.ts`: Canvas 渲染 + 碰撞检测
- `danmaku/controller.ts`: 时间轴同步 + 用户控制

**工作量**: ~10h

### Phase 6: 高级功能 (待实现)

功能:说明:优先级
Ambilight:环境光背景 (canvas 提取色):P2
Fallback 链:多源 URL 自动切换:P1
锁定模式:点击固定 viewer:P2
缩放平移:滚轮缩放 + 拖动:P1
旋转/翻转:R 键旋转 F 键翻转:P3
下载命名:模板: `<host>/<filename>`:P3

---

## 架构优势 (vs HZ+)

维度:HZ+: Halo HoverZoom
语言:JS: TypeScript
依赖:jQuery 296KB: 零依赖
结构:单文件 4792 行: 模块化 ≤200 行/文件
规则:396 独立 plugins: RuleEngine 统一注册
加载:全量同步: 按需懒加载
样式:内联 JS: 独立 CSS + CSS 变量
类型:无: 完整 TS 类型
测试:无: Playwright 集成
体积:1.3MB (hls.js): 6KB (MSE 原生)

---

## 变更记录

- **2026-01-09 AM**: Phase 1-3 完成

  - Info bar: 9 项可配置信息 (typeIcon/dims/ratio/scale/format/size/caption/source/hostname)
  - 详情增强: ratio (GCD 简化比例) + scale (显示缩放百分比)
  - 视频播放: MSE 播放器 (6KB) 替代 hls.js (1MB)，B 站 DASH 流支持
  - 视频保护: 跳过正在播放的视频，避免干扰原生预览

- **2026-01-09 PM**: 视频性能极致优化

  - 流式增量加载: 首批 2MB 快速显示 → 后台持续加载后续批次 → 无缝播放
  - 动态分辨率: 根据 viewport (90%) 自动选择合适画质 (避免 4K 屏强制 1080P)
  - Background Proxy: 支持 arraybuffer (base64 分块编码，32KB 块)
  - 新增设置: videoFallbackToImage (默认 false，视频失败不降级)
  - CORS 修复: Referer header 通过 background proxy 正确发送

- **2026-01-09 EVE**: B 站体验增强

  - 视频音频: 移除静音限制，MSE 和标准视频均可播放声音
  - 图片规则增强: 扩展 match 模式 (`/bfs/|@`)，支持更多缩略图类型
  - 新增 host: biliimg.com
  - **待实现**: 弹幕功能 (需 Phase 5+)

- **2026-01-09 NIGHT**: 图片原图规则修复

  - 移除错误的 `/archive/` 排除 → 视频封面也能获取原图
  - `media-loader.ts` 添加内联 HD 转换 → 视频回退缩略图时自动获取原图
  - `rule-resolver.ts` 优化 → 用户偏好图片时缩略图也应用 HD 规则
  - 弹幕 Phase 5 规划完成 → `docs/plan-danmaku.md`

- **2026-01-09 NIGHT+**: 固定悬浮模式 + 视频首帧优化
  - **固定悬浮**: 按 pinKey (默认空格) 固定浮窗，支持拖动移动和四角缩放
  - **按键隔离**: 固定时 stopImmediatePropagation 阻止按键冒泡到页面
  - **关闭按钮**: 固定后显示 X 关闭按钮，Esc 也可关闭
  - **视觉反馈**: 固定状态蓝色边框 + 📌 图标
  - **视频首帧优化**: 初始加载 768KB (原 2MB) 快速显示首帧
