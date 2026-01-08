# Hover Zoom 参考项目规则索引

> 生成时间: 2026-01-08 | 用于 AI 快速定位规则位置

---

## 1. Hover Zoom+ (Hz+)

**路径**: `reference/hoverzoom-plus/plugins/`
**总计**: 396 个独立 JS 文件

### 关键站点索引

| 站点       | 文件                                     | 大小                |
| ---------- | ---------------------------------------- | ------------------- |
| Twitter    | `twitter.js`, `twitter_a.js`, `twimg.js` | 3.5KB, 1.7KB, 0.8KB |
| Reddit     | `reddit.js`                              | 11.7KB              |
| Imgur      | `imgur_a.js`                             | 14.5KB              |
| Bilibili   | `bilibili_a.js`                          | 20KB                |
| Facebook   | `facebook.js`, `facebook_a.js`           | 48KB, 2.6KB         |
| Instagram  | `instagram.js`, `instagram_a.js`         | 26KB, 6KB           |
| YouTube    | `youtube_a.js`                           | 7.7KB               |
| Flickr     | `flickr.js`, `flickr_a.js`               | 28KB, 3.4KB         |
| DeviantArt | `deviantart.js`, `deviantart_a.js`       | 10.8KB, 0.5KB       |
| Pixiv      | `pixiv.js`                               | 14.7KB              |
| TikTok     | `tiktok.js`, `tiktok_a.js`               | 11.8KB, 20.3KB      |
| Douyin     | `douyin.js`, `douyin_a.js`               | 7.7KB, 10.1KB       |
| Pinterest  | `pinterest.js`                           | 6.9KB               |
| Spotify    | `spotify.js`                             | 25.4KB              |
| Tumblr     | `tumblr_a.js`                            | 7.1KB               |
| Twitch     | `twitch_a.js`                            | 12.7KB              |
| Amazon     | `amazon.js`, `media-amazon_a.js`         | 1.4KB, 0.8KB        |
| eBay       | `ebay.js`, `ebay_a.js`                   | 4.4KB, 0.9KB        |
| Bluesky    | `bluesky.js`                             | 1KB                 |
| Naver      | `naver.js`                               | 20.2KB              |

### 命名规则

- `xxx.js` - 基础规则 (URL 替换为主)
- `xxx_a.js` - 高级规则 (需要 fetch/API 调用)

---

## 2. PhotoShow

**路径**: `reference/photoshow/source/background.js`
**结构**: 单文件 websiteConfig 对象 (186KB, 4495 行)

### 完整站点索引 (120+ 站点, 精确行号)

行号:站点 Key (正则)
L336: `115.com`
L368: `123rf.com`
L378: `500px.com`
L486: `acfun.cn / kuaishou.com`
L502: `acpjournals.org`
L513: `adnmb.com`
L520: `afdian.net`
L547: `allhistory.com`
L558: `allelitewrestling.com`
L566: `amazon.com` ⭐
L598: `andino.shop`
L613: `apple.com`
L623: `artstation.com`
L656: `baidu.com (image)`
L707: `baike.baidu.com`
L717: `haokan.baidu.com`
L732: `map.baidu.com`
L764: `tieba.baidu.com`
L837: `bandcamp.com`
L846: `bangumi.tv / bgm.tv`
L866: `behance.net`
L894: `bestbuy.com`
L910: `bilibili.com` ⭐
L942: `bing.com`
L1003: `briscoes.co.nz`
L1014: `bunnings.com.au`
L1026: `cangku`
L1037: `catch / cudo / deals (AU/NZ)`
L1060: `cnu.cc`
L1075: `coupang.com`
L1084: `countdown.co.nz`
L1102: `ctrip.com`
| L1113 | `dangdang.com` |
| L1124 | `deviantart.com` |
| L1235 | `dhgate.com` |
| L1250 | `dianping / meituan.com` |
| L1288 | `discogs.com` |
| L1328 | `dizilah.com` |
| L1358 | `douban.com` ⭐ |
| L1399 | `douyin.com` ⭐ |
| L1409 | `douyu.com` |
| L1426 | `dribbble.com` |
| L1443 | `duckduckgo.com` |
| L1498 | `duitang.com` |
| L1507 | `duokan.com` |
| L1513 | `e-talenta.eu` |
| L1519 | `e621.net` |
| L1533 | `ebay.com` |
| L1554 | `etsy.com` |
| L1569 | `facebook.com` ⭐ |
| L1733 | `fandango / flixster / rottentomatoes` |
| L1758 | `flickr.com` ⭐ |
| L1826 | `fox.com` |
| L1836 | `fox.com.tr` |
| L1846 | `xda-developers.com` |
| L1865 | `gamer.com.tw` |
| L1894 | `github.com` |
| L1908 | `play.google.com` |
| L1921 | `google.com (images)` |
| L2015 | `huaban.com` |
| L2037 | `huya.com` |
| L2046 | `iherb.com` |
| L2066 | `imdb.com` |
| L2077 | `imgur.com` ⭐ |
| L2087 | `interpals.net` |
| L2093 | `istockphoto / pexels / unsplash` |
| L2124 | `instacart.com` |
| L2130 | `instagram.com` ⭐ |
| L2285 | `iqiyi.com` |
| L2308 | `ixigua.com` |
| L2315 | `jamanetwork.com` |
| L2324 | `jandan.net` |
| L2360 | `javbus / javseejseejav` |
| L2392 | `jd.com / yhd.com / tuniu` ⭐ |
| L2417 | `justwatch.com` |
| L2446 | `kanald.com.tr` |
| L2458 | `kinopoisk.ru` |
| L2546 | `kmart.com` |
| L2553 | `kmart.com.au` |
| L2559 | `teams.live.com` |
| L2568 | `lofter.com` |
| L2583 | `mafengwo.cn` |
| L2592 | `meiye.art` |
| L2598 | `metal-archives.com` |
| L2603 | `mi.com / xiaomiyoupin` |
| L2621 | `mikanani.me` |
| L2627 | `mi-store.com` |
| L2633 | `moegirl.org.cn` |
| L2645 | `addons.mozilla.org` |
| L2657 | `music.163.com` |
| L2669 | `mxdm8.com` |
| L2682 | `myprotein.com` |
| L2698 | `nejm.org` |
| L2714 | `newegg.com` |
| L2732 | `newworld.co.nz` |
| L2744 | `nga.cn` |
| L2750 | `nipic / huitu.com` |
| L2769 | `njpwworld.com` |
| L2775 | `noelleeming.co.nz` |
| L2794 | `nzsale.co.nz` |
| L2800 | `paknsave.co.nz` |
| L2806 | `pbtech.co.nz` |
| L2817 | `pinterest.com` ⭐ |
| L2835 | `pixiv.net / booth.pm / vroid` ⭐ |
| L2889 | `poco.cn` |
| L2900 | `pornhub.com` |
| L2946 | `qzone.qq.com` |
| L2971 | `razorsql.com` |
| L2976 | `reddit.com` ⭐ |
| L2991 | `sellersuniononline.com` |
| L2997 | `soutushenqi.com` |
| L3036 | `suning.com` |
| L3054 | `target.com` |
| L3067 | `taptap.com` |
| L3079 | `themarket.com` |
| L3091 | `thewarehouse.co.nz` |
| L3097 | `tiktok.com` ⭐ |
| L3112 | `tmall / taobao / aliexpress / 1688` ⭐ |
| L3152 | `toutiao.com` |
| L3171 | `trademe.nz` |
| L3199 | `torpedo7.co.nz` |
| L3211 | `tumblr.com` ⭐ |
| L3260 | `twitter.com / x.com` ⭐ |
| L3290 | `vcg.com` |
| L3305 | `wallhaven.cc` |
| L3326 | `walmart.com` |
| L3336 | `wattpad.com` |
| L3359 | `web-zones.ru` |
| L3368 | `weibo.com` ⭐ |
| L3408 | `weixin.qq.com` |
| L3420 | `wikiart.org` |
| L3426 | `wikipedia / wikimedia` |
| L3434 | `xiaohongshu.com` ⭐ |
| L3468 | `konachan / yande.re` |
| L3507 | `yandex.com` |
| L3569 | `yelp.com` |
| L3590 | `yiigle.com` |
| L3598 | `youku / tudou.com` |
| L3633 | `youtube.com` ⭐ |
| L3676 | `zcool.com.cn / hellorf` |
| L3699 | `zhipin.com` |
| L3705 | `zhisheji.com` |
| L3720 | `zhihu.com` ⭐ |

> ⭐ = 主流高流量站点

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
**结构**: JSON (864KB, 5026 行) | **总计**: 480+ 规则
**完整列表**: `reference/imagus-rules-list.txt`

### 主流站点 (✅ 已有)

| 站点      | 规则名                                             |
| --------- | -------------------------------------------------- |
| Twitter/X | `X.COM-h-p` `X.COM_pic.x` `X.COM_proxy`            |
| Reddit    | `REDDIT_gallery` `REDDIT_video` `REDDIT_post` (+3) |
| Imgur     | `IMGUR-h` `IMGUR-set-h` `IMGUR.io_redirect-h`      |
| Instagram | `INSTAGRAM_graphql-p` `INSTAGRAM_Stories-p` (+5)   |
| YouTube   | `YOUTUBE-h-q-p` `YOUTUBE_redirect`                 |
| Facebook  | `FACEBOOK-h-p` `FACEBOOK_vid-h-p` `FACEBOOK_fb-g`  |
| Bilibili  | `BILIBILI`                                         |
| Pinterest | `PINTEREST-g`                                      |
| Pixiv     | `PIXIV-g-x-q-p`                                    |
| TikTok    | `TIKTOK-p`                                         |
| Weibo     | `WEIBO-h`                                          |

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
