# Halo Hover Zoom 集成方案

> update: 2026-01-06 | status: planning

## §1 背景 & 目标

目标: 增强 Halo 悬浮放大功能，覆盖更多站点 (B 站/Twitter/etc)，提升性能与交互体验。
现状: 已深度分析三大开源方案，拟采用 "自研引擎 + 融合规则" 策略。

## §2 竞品深度分析

### 2.1 对比矩阵

| 维度     | Hover Zoom+                            | PhotoShow                    | Imagus-Reborn             |
| -------- | -------------------------------------- | ---------------------------- | ------------------------- |
| 许可     | ✅ MIT (2012-2025)                     | ⚠️ MIT→Closed (2024-07)      | ⚠️ 无许可                 |
| 规则数   | 396 JS 插件                            | ~200 站配置                  | ~800+ JSON 规则           |
| 规则格式 | `hoverZoomPlugins.push({...})`         | `websiteConfig[regex]={...}` | `{link,img,res,to}` JSON  |
| 核心引擎 | `hoverzoom.js` (4792 行)               | `background.js` (4495 行)    | `service.js` (583 行)     |
| 依赖     | jQuery 3.7 + HLS.js                    | jQuery 3.6                   | 无依赖                    |
| MV3      | 部分适配                               | 部分适配                     | ✅ 完整 (UserScripts API) |
| 视频     | ✅ DASH/HLS (video+audio 合并)         | ❌ 仅图片                    | ✅ Video.js 动态加载      |
| 跨域     | `chrome.runtime.sendMessage` → BG 代理 | `CROSS_ORIGIN_GET` 消息      | fetch 直接调用            |
| 活跃度   | ⭐⭐⭐⭐⭐                             | ❌ 已闭源                    | ⭐⭐⭐ 社区维护           |
| 可复用   | 主要参考 (MIT)                         | 交互/结构参考                | 仅数据参考                |

### 2.2 关键技术发现

**Hover Zoom+ 插件格式** (核心参考):

```javascript
hoverZoomPlugins.push({
  name: "bilibili_a",
  version: "0.6",
  prepareImgLinks: function (callback) {
    // 1. jQuery 选择器匹配元素
    // 2. 正则提取 ID → API 调用 (通过 BG 代理)
    // 3. 解析 JSON → 取最高画质 video+audio URL
    // 4. callback(link, name) 返回结果
  },
});
```

**PhotoShow 规则格式** (结构参考):

```javascript
websiteConfig["bilibili\\.com"] = {
  amendStyles: { pointerNone: ".mask" },
  srcMatching: [
    {
      selectors: "img,[style*=background]",
      srcRegExp: "(.+)@.*",
      processor: "$1", // 或 (trigger, src, regex) => Promise<string>
    },
  ],
  onXhrLoad: (url, response) => {
    /* 缓存 HD src */
  },
};
```

**Imagus-Reborn 规则格式** (数据参考):

```json
{
  "BILIBILI": {
    "link": "^bilibili\\.com/video/.+",
    "res": ":\n$=$._.match(/window\\.__playinfo__=({.+?})<\\//);\n...",
    "note": "..."
  }
}
```

### 2.3 B 站实现分析 (Hz+ bilibili_a.js)

数据源:

1. 页面内嵌 `window.__playinfo__` / `window.__INITIAL_STATE__`
2. API: `api.bilibili.com/x/player/playurl?cid=&bvid=&fnval=`
3. 番剧 API: `api.bilibili.com/pgc/player/web/playurl?fnval=&ep_id=`
4. 国际站 API: `api.bilibili.tv/intl/gateway/web/playurl?platform=web&ep_id=`

流处理: DASH 分离流 → 选最高 bandwidth → video.baseUrl + audio.baseUrl 合并

跨域: CORB 限制 → 必须通过 Background 代理 AJAX

## §3 集成策略

### 3.1 架构设计 (Core + Adapter)

```
src/tools/hover-zoom/
├── core/
│   ├── engine.ts          # 事件监听/调度 (精简重构)
│   ├── resolver.ts        # URL 解析器 (统一规则调度)
│   └── viewer.ts          # UI 呈现 (参考 PhotoShow 交互)
├── rules/
│   ├── types.ts           # SiteRule 统一接口
│   ├── registry.ts        # 规则加载器 (按需加载)
│   ├── common/            # 通用规则 (CDN/正则替换)
│   └── sites/             # 站点规则 (TS 模块)
│       ├── bilibili.ts
│       ├── twitter.ts
│       └── ...
└── adapters/
    └── hz-plus-compat.ts  # Hz+ 老规则快速适配层
```

### 3.2 技术决策

| 决策点   | 建议                        | 理由                             |
| -------- | --------------------------- | -------------------------------- |
| 依赖     | 移除 jQuery                 | 现代化 + 体积 + Halo 架构一致    |
| 视频     | 引入 hls.js (已有 Hz+ 实现) | DASH/HLS 支持                    |
| 跨域     | Background 代理 AJAX        | Hz+ 模式，MV3 兼容               |
| 规则格式 | TS 函数模块                 | 类型安全 + Tree-shaking + 可调试 |
| UI 交互  | 参考 PhotoShow              | 平滑动画 + 快捷键 + 缩放         |

### 3.3 统一规则接口

```typescript
interface SiteRule {
  id: string;
  name: string;
  matches: (host: string) => boolean;
  probe?: string; // CSS 选择器 (性能优化)
  resolve: (ctx: ResolveContext) => Promise<ZoomResult | null>;
  priority?: number;
}

interface ResolveContext {
  url: string;
  element: Element;
  pageUrl: string;
  fetchWithProxy: (url: string, opts?) => Promise<Response>;
}

interface ZoomResult {
  type: "image" | "video" | "gallery";
  sources: string[]; // 优先级排序
  poster?: string;
  caption?: string;
  headers?: Record<string, string>;
}
```

## §4 执行计划

### P0 原型验证

- [ ] 实现 `bilibili.ts` (基于 Hz+ bilibili_a.js 移植)
- [ ] 验证 API 跨域代理 (Background 消息机制)
- [ ] 验证 DASH 视频解析 (video+audio 合并)

### P1 核心重构

- [ ] `viewer.ts`: 平滑缩放/视频播放/快捷键
- [ ] `engine.ts`: 事件防抖/DOM 监听/MutationObserver

### P2 规则迁移

- [ ] 批量转换 Hz+ 头部插件 (Twitter, Reddit, Instagram)
- [ ] 建立规则转换 Prompt/工具

### P3 UI 优化

- [ ] 加载动画/错误处理
- [ ] 快捷键配置面板

## §5 参考资源

- Hz+: `reference/hoverzoom-plus/` (MIT, 主要参考)
- PhotoShow: `reference/photoshow/` (交互/结构参考)
- Imagus: `reference/imagus-reborn/` (仅数据参考, 无许可)
