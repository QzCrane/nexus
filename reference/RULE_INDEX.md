# Hover Zoom 参考项目规则索引

> 生成时间: 2026-01-08 | 用于 AI 快速定位规则位置

---

## 1. Hover Zoom+ (Hz+)

**路径**: `reference/hoverzoom-plus/plugins/`
**总计**: 396 插件 (377 站点)
**完整列表**: `reference/hz-rules-list.txt`

### 命名规则

- `xxx.js` - 基础规则 (URL 替换为主)
- `xxx_a.js` - 高级规则 (需要 fetch/API 调用)

---

## 2. PhotoShow

**路径**: `reference/photoshow/source/background.js`
**结构**: 单文件 websiteConfig 对象 (186KB, 4495 行)
**总计**: 143 规则
**完整列表**: `reference/photoshow-rules-list.txt`

### 配置结构

```js
websiteConfig = {
  'regex_pattern': {
    amendStyles: { pointerNone, pointerAuto },  // CSS 修正
    srcMatching: [{  // 规则数组
      selectors: 'img,.class',
      srcRegExp: 'pattern',
      processor: '$1$2' | function(trigger, src, srcRegExpObj)
    }],
    xhrDownload: ['hostname'],  // 需要 referer 的下载
    onXhrLoad: function,        // XHR 拦截
    onPageLoad: function        // 页面加载回调
  }
}
```

---

## 3. Imagus-Reborn

**路径**: `reference/imagus-reborn/src/data/sieve.json`
**结构**: JSON (864KB, 5026 行) | **总计**: 823 规则 (722 站点)
**完整列表**: `reference/imagus-rules-list.txt`

### 系统规则

`[Google_Images]` `[data:image]` `[HLS_Player]` `[Extension]` `[Audio Formats]` `[_dereferers_]`

### 规则结构

```json
{
  "SiteName-flags": {
    "link": "regex_for_page_url",
    "url": "fetch_url_pattern",
    "res": "response_regex_or_js_code",
    "img": "regex_for_img_url",
    "to": "replacement_pattern",
    "loop": 1-3,
    "note": "author_and_examples"
  }
}
```

### 标志含义

| Flag | 含义             |
| ---- | ---------------- |
| `-g` | Gallery (相册)   |
| `-s` | Slider (轮播)    |
| `-h` | Hover (悬停)     |
| `-p` | Page (页面解析)  |
| `-x` | XXX (成人)       |
| `-q` | Quality (多质量) |
| `-m` | Mobile           |

---

## 快速查找指南

### 当需要改进某站点规则时:

1. **先查 Hz+**: 最完整，代码清晰
   - 看 `plugins/站点名.js` 和 `plugins/站点名_a.js`
2. **再查 PhotoShow**: 单文件好搜索
   - `Ctrl+F` 搜索站点域名 → 查看行号
3. **最后查 Imagus-Reborn**: 覆盖面窄但有独特实现
   - 搜索 `sieve.json` 中的站点名

### 关键功能参考来源

功能:最佳参考
视频流解析 (DASH/HLS):Hz+ reddit.js, bilibili_a.js
短链展开:Hz+ twitter_a.js
API 调用:Hz+ imgur_a.js, instagram_a.js
Gallery/Album:Hz+ reddit.js, imgur_a.js
异步处理:PhotoShow (Promise pattern)
CSS 修正:PhotoShow amendStyles
