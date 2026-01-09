# Bilibili 规则整理

> 2026-01-09 | 来源: HoverZoom+ / PhotoShow / Imagus

---

## 📊 规则覆盖对比

| 功能              | HZ+ | PS  | IM  | Halo |
| ----------------- | --- | --- | --- | ---- |
| 图片去水印(@参数) | ✅  | ✅  | ❌  | ✅   |
| 视频(BV/av)       | ✅  | ❌  | ✅  | ✅   |
| 番剧(ep)          | ✅  | ❌  | ❌  | ✅   |
| bilibili.tv       | ✅  | ❌  | ❌  | ✅   |
| 动态图片          | ❌  | ✅  | ❌  | ⚠️   |
| 用户头像          | ✅  | ✅  | ❌  | ⚠️   |

---

## 🔍 HoverZoom+ 规则 (bilibili_a.js)

**文件**: `reference/hoverzoom-plus/plugins/bilibili_a.js`

### 1. 图片去水印

```js
// 匹配: img[src*="hdslb.com"], img[src*="pic.bstarstatic.com"]
// 正则: /(.*)@.*/
// 替换: '$1'
// 示例: xxx.jpg@672w_378h.avif → xxx.jpg
```

### 2. 视频 (BV/av)

```js
// 选择器: a[href*="/video/"], a[data-target-url]
// 匹配: /bilibili\.com\/video\/([^\/\?]{1,})/
// 策略:
//   A. 页面内嵌 __playinfo__ → 直接解析 DASH
//   B. API: api.bilibili.com/x/player/playurl?cid=X&bvid=Y&fnval=976
// 输出: videoUrl + '_' + audioUrl (DASH 分离流)
```

### 3. 番剧 Episode

```js
// 选择器: a[href*="/play/"]
// 匹配: /bilibili\.com\/.*\/play\/ep(\d+)/
// API: api.bilibili.com/pgc/player/web/playurl?fnval=4048&ep_id=X
// 响应字段: result.dash.video/audio
```

### 4. bilibili.tv (海外)

```js
// Series: /bilibili\.tv.*\/play\/\d+\/(\d+)/
// Videos: /bilibili\.tv.*\/video\/(\d+)/
// API: api.bilibili.tv/intl/gateway/web/playurl?platform=web&ep_id=X
//      api.bilibili.tv/intl/gateway/web/playurl?platform=web&aid=X
```

---

## 🔍 PhotoShow 规则 (background.js:910-940)

**域**: `.+\.bili(?:bili|game)\.com`

### CSS 修正 (pointerNone)

```css
.biref-img img~*,
.bili-avatar img~*,
.groom-module .card-mark,
.spread-module .pic img~*,
.cover-ctn .cover-back,
.hot-list-content .hover-mask,
.play-mask,
.recommend-box .info,
.hover-cover-box *,
.image-area *:not(img),
/* ... 更多 */
```

### 图片匹配规则

```js
// 规则1: hdslb.com 图片
srcRegExp: "(.+.hdslb.com/.+?@IMG@)[^?]*(\\?.*)?";
processor: "$1$2";
// 移除 @ 后缩略图参数，保留 query string

// 规则2: 动态卡片容器
selectors: ".cardBangumibox .modal-box, .song-shadow, .pic-box, .bili-dyn-card-video__cover";
// 从容器内提取最大图片

// 规则3: biligame wiki
srcRegExp: "(patchwiki.biligame.com/images/.+?/)thumb/(.+?@IMG@).*";
processor: "$1$2";
```

---

## 🔍 Imagus 规则 (sieve.json:537-540)

**极简实现** - 仅视频，无音频

```json
{
  "BILIBILI": {
    "link": "^bilibili\\.com/video/.+",
    "res": "解析 __playinfo__ → dash.video 最高码率"
  }
}
```

**注**: Imagus 明确标注 "只播放视频，无音频"

---

## 🎯 Halo 现有实现分析

**文件**: `nexus/apps/extension-halo/src/tools/hover-zoom/rules/definitions/bilibili.ts`

### 优势

- ✅ 完整 DASH 解析 (视频+音频分离)
- ✅ 支持 BV/av/ep/bilibili.tv 四种类型
- ✅ 嵌入式 + API 双策略回退
- ✅ 保留 query 参数 (token auth)

### 差距

1. **缺少 CSS 修正** - PhotoShow 有大量 `pointerNone` 修正，防止遮罩层阻挡点击
2. **缺少动态场景** - `bili-dyn-card-video__cover` 等选择器未覆盖
3. **缺少用户头像** - hdslb.com/bfs/face/ 路径未处理
4. **缺少 biligame wiki** - patchwiki.biligame.com 未覆盖

---

## 🚀 改进建议

### P1: 添加 CSS 修正 (styles.ts)

```ts
const BILIBILI_POINTER_NONE = `
  .bili-avatar img ~ *,
  .hover-cover-box *,
  .play-mask,
  .cover-mask,
  .video-mask,
  .pl__mask
`;
```

### P2: 扩展 hosts 列表

```ts
hosts: ["hdslb.com", "bstarstatic.com", "bilivideo.com", "biligame.com"];
```

### P3: 添加动态封面选择器到 needsAsyncResolve

```ts
ASYNC_RESOLVE_PATTERNS.push(
  ".bili-dyn-card-video__cover",
  ".cardBangumibox .modal-box"
);
```

### P4: 用户头像规则

```ts
{
  id: 'bilibili-avatar',
  hosts: ['hdslb.com'],
  match: /\/bfs\/face\//,
  resolve: (ctx) => ctx.url.replace(/@\d+w_\d+h[^?]*/, '')
}
```
