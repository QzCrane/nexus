# Halo Hover Zoom 集成方案

> update: 2026-01-08 | status: ✅ implemented

## §1 背景

目标: 增强悬浮放大，覆盖 B 站/Twitter/etc，提升性能与交互
策略: 自研引擎 + 融合规则

## §2 竞品分析

### 对比

Hz+(主参考): MIT | 396 JS | `hoverZoomPlugins.push({...})` | jQuery+HLS | ✅DASH 合并 | BG 代理跨域
PhotoShow(结构参考): MIT→ 闭源 | ~200 站 | `websiteConfig[regex]={...}` | 仅图片
Imagus(数据参考): 无许可 | 800+ JSON | `{link,img,res,to}` | Video.js

### B 站实现 (Hz+ bilibili_a.js)

数据源: `window.__playinfo__`/`__INITIAL_STATE__` | API(`x/player/playurl`/`pgc/player/web/playurl`/`bilibili.tv/intl/gateway`)
流处理: DASH 分离流 → 按 bandwidth 降序 → video.baseUrl + audio.baseUrl
跨域: CORB 限制 → Background 代理 AJAX

## §3 集成策略

### 架构

```
src/tools/hover-zoom/
├── rules/{core.ts, registry.ts, definitions/}  # SiteRule统一接口
├── content/{viewer/, styles/}                  # UI呈现(参考PhotoShow)
└── background/                                 # 跨域代理
```

### 决策

移除 jQuery | hls.js(DASH/HLS) | BG 代理 | TS 函数模块(类型安全+Tree-shaking)

### 统一接口

```typescript
interface SiteRule {
  id: string;
  hosts: string[];
  match: RegExp;
  resolve: (ctx: ResolveContext) => Promise<RuleResult | string | null>;
}
interface RuleResult {
  url: string;
  audioUrl?: string;
  type: "image" | "video";
  headers?: Record<string, string>;
}
```

## §4 执行状态

✅ P0 原型: bilibili.ts(BV/av/分 P/番剧/TV) | API 跨域代理 | DASH 解析
✅ P1 重构: viewer(平滑缩放/视频/快捷键) | engine(事件/MutationObserver)
🔄 P2 迁移: Twitter/Reddit/Instagram 规则转换

## §5 参考

Hz+: `reference/hoverzoom-plus/` (MIT)
PhotoShow: `reference/photoshow/` (交互参考)
Imagus: `reference/imagus-reborn/` (数据参考, 无许可)
