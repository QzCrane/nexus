/**
 * NEXUS Audio Engine - 音频处理常量配置
 * 
 * 从原 VolumeBooster config.js 迁移，提供类型安全的常量定义。
 * 所有硬编码值都在此文件中统一管理。
 */

// ============================================
// 音频处理模式
// ============================================

/** 音频处理模式枚举 */
export const AudioMode = {
  /** 原生 WebAudio 模式 - 完整音频处理链 */
  NATIVE_WEBAUDIO: 'NATIVE_WEBAUDIO',
  /** 原生精简模式 - 仅 DOM 音量控制 */
  NATIVE_LITE: 'NATIVE_LITE',
  /** Tab Capture 模式 - 劫持标签页音频 */
  CAPTURE: 'CAPTURE'
} as const;

/** 音频处理模式类型 */
export type AudioModeType = typeof AudioMode[keyof typeof AudioMode];

// ============================================
// 音频参数配置
// ============================================

/** 音频处理参数 */
export const AudioParams = {
  /** 10 段均衡器频率点 (Hz) */
  EQ_FREQUENCIES: [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const,
  /** EQ Q 值 (品质因数) */
  EQ_Q: 1.4,
  /** 低音增强截止频率 (Hz) */
  BASS_FREQUENCY: 200,
  /** 低音增强增益 (dB) */
  BASS_GAIN: 10,
  /** 参数平滑过渡时间 (秒) */
  SMOOTH_TIME: 0.1,
  /** 快速响应平滑时间 (秒) */
  SMOOTH_TIME_FAST: 0.05,
  /** FFT 分析器大小 */
  FFT_SIZE: 256,
  /** 最大音量百分比 */
  MAX_VOLUME: 800,
  /** 音量调节步长 */
  VOLUME_STEP: 10,
  /** EQ 最小增益 (dB) */
  EQ_MIN: -12,
  /** EQ 最大增益 (dB) */
  EQ_MAX: 12,
  /** EQ 调节步长 (dB) */
  EQ_STEP: 0.1
} as const;

/** 压缩器参数 - 开启状态 */
export const CompressorOn = {
  threshold: -24,
  knee: 30,
  ratio: 12,
  attack: 0.003,
  release: 0.25
} as const;

/** 压缩器参数 - 关闭状态 (旁通) */
export const CompressorOff = {
  threshold: 0,
  ratio: 1
} as const;

/** 压缩器参数 - 原生模式关闭 */
export const CompressorNativeOff = {
  threshold: -10,
  ratio: 1
} as const;

// ============================================
// UI 颜色常量 (统一定义，供所有模块使用)
// ============================================

/** UI 颜色常量 */
export const UIColors = {
  /** 紫色 - Capture 劫持模式 */
  CAPTURE: '#7c3aed',
  /** 蓝色 - Native 原生模式 */
  NATIVE: '#2563eb',
  /** 灰色 - 静音状态 */
  MUTED: '#9ca3af',
  /** 白色 */
  WHITE: '#ffffff',
} as const;

// ============================================
// 受限域名配置
// ============================================

/** 
 * 默认受限域名列表
 * 这些网站由于 CORS 限制，无法使用原生 WebAudio 模式
 */
export const DefaultRestrictedDomains = [
  'douyin.com',
  'live.douyin.com',
  'netflix.com',
  'spotify.com'
] as const;

// ============================================
// 播放页/预览页检测规则 (V2 统一结构)
// ============================================

/** 
 * 完整站点规则 (V2)
 * 合并播放页和预览页规则为统一结构
 */
export interface CompleteSiteRule {
  /** 规则名称 (用于日志) */
  name: string;
  /** 域名匹配模式 */
  hostPattern: string;
  /** 是否为受限站点 (CORS 限制) */
  isRestricted?: boolean;
  /** 直播子域名列表 (整站视为播放页) */
  liveSubdomains?: readonly string[];
  /** 播放页路径模式 */
  playPaths?: readonly string[];
  /** 播放页路径正则 */
  playPathRegex?: readonly RegExp[];
  /** 预览页路径模式 */
  previewPaths?: readonly string[];
  /** 预览页子域名 */
  previewSubdomains?: readonly string[];
}

/** 
 * 统一站点规则表 (V2)
 * 每个站点只有一条完整规则
 */
export const CompleteSiteRules: readonly CompleteSiteRule[] = [
  {
    name: '抖音',
    hostPattern: 'douyin.com',
    isRestricted: true,
    liveSubdomains: ['live'],
    // 抖音首页就是视频流播放页，需要 CAPTURE 支持
    playPaths: ['/', '/video', '/live'],
    // 仅搜索/推荐/发现等明确的"浏览列表"页面视为预览
    previewPaths: ['/jingxuan', '/recommend', '/hot', '/discover', '/search']
  },
  {
    name: 'YouTube',
    hostPattern: 'youtube.com',
    isRestricted: false,
    playPaths: ['/watch', '/embed', '/shorts'],
    previewPaths: ['/results', '/c/', '/channel/', '/@', '/feed', '/trending']
  },
  {
    name: 'Bilibili',
    hostPattern: 'bilibili.com',
    isRestricted: false,
    playPaths: ['/video', '/bangumi', '/cheese', '/festival', '/blackboard', '/list', '/medialist', '/watchlater'],
    playPathRegex: [/\/video\/BV/, /\/video\/av/],
    previewPaths: ['/search', '/v/'],
    previewSubdomains: ['search', 'space']
  },
  {
    name: 'Netflix',
    hostPattern: 'netflix.com',
    isRestricted: true,
    playPaths: ['/watch'],
    previewPaths: ['/browse', '/title']
  },
  {
    name: 'TikTok',
    hostPattern: 'tiktok.com',
    isRestricted: true,
    playPaths: ['/video'],
    playPathRegex: [/@[\w.-]+\/video\//],
    previewPaths: ['/foryou', '/following', '/explore', '/search']
  },
  {
    name: 'Spotify',
    hostPattern: 'spotify.com',
    isRestricted: true,
    playPaths: ['/track/', '/episode/'],
    previewPaths: ['/browse', '/search', '/playlist', '/album']
  },
  {
    name: '腾讯视频',
    hostPattern: 'v.qq.com',
    isRestricted: true,
    playPaths: ['/x/cover', '/x/page'],
    previewPaths: ['/', '/channel', '/u/']
  },
  {
    name: '爱奇艺',
    hostPattern: 'iqiyi.com',
    isRestricted: true,
    playPaths: ['/v_'],
    playPathRegex: [/\/v_\w+\.html/],
    previewPaths: ['/', '/lib/', '/dianshiju/', '/dongman/']
  },
  {
    name: '优酷',
    hostPattern: 'youku.com',
    isRestricted: true,
    playPaths: ['/v_show'],
    previewPaths: ['/', '/channel/', '/category/']
  },
  {
    name: '芒果TV',
    hostPattern: 'mgtv.com',
    isRestricted: true,
    playPaths: ['/b/'],
    playPathRegex: [/\/b\/\d+\/\d+\.html/],
    previewPaths: ['/', '/h/', '/lib/']
  },
  {
    name: 'Twitch',
    hostPattern: 'twitch.tv',
    isRestricted: false,
    playPaths: ['/videos/'],
    playPathRegex: [/^\/[\w]+$/], // 直播频道 (/username)
    previewPaths: ['/directory', '/following']
  },
  {
    name: '西瓜视频',
    hostPattern: 'ixigua.com',
    isRestricted: true,
    playPathRegex: [/^\/\d+/], // 视频ID路径
    previewPaths: ['/', '/home', '/channel']
  }
] as const;

// ============================================
// 兼容性导出 (旧接口)
// ============================================

/** @deprecated 使用 CompleteSiteRule 代替 */
export interface SitePlayPageRule {
  name: string;
  hostPattern: string;
  liveSubdomains?: readonly string[];
  pathPatterns?: readonly string[];
  pathRegex?: readonly RegExp[];
}

/** 
 * @deprecated 使用 CompleteSiteRules 代替
 * 从 CompleteSiteRules 提取播放页规则
 */
export const DefaultSiteRules: readonly SitePlayPageRule[] = CompleteSiteRules.map(rule => ({
  name: rule.name,
  hostPattern: rule.hostPattern,
  liveSubdomains: rule.liveSubdomains,
  pathPatterns: rule.playPaths,
  pathRegex: rule.playPathRegex
}));

/** 
 * @deprecated 使用 CompleteSiteRules 代替
 * 从 CompleteSiteRules 提取预览页规则
 */
export const DefaultPreviewRules: readonly SitePlayPageRule[] = CompleteSiteRules
  .filter(rule => rule.previewPaths || rule.previewSubdomains)
  .map(rule => ({
    name: `${rule.name} 预览`,
    hostPattern: rule.hostPattern,
    liveSubdomains: rule.previewSubdomains,
    pathPatterns: rule.previewPaths,
    pathRegex: undefined
  }));

/** URL 检测配置 */
export const UrlDetection = {
  /** 视频相关 URL 参数 */
  VIDEO_PARAMS: ['modal_id', 'video_id', 'vid', 'v', 'bvid', 'aid', 'ep_id'] as const,
  /** Hash 中视频关键词匹配 */
  HASH_VIDEO_KEYWORDS: /video|modal|play|watch/i,
  /** 通用路径模式 (兜底匹配) */
  GENERIC_PATH_PATTERNS: [
    /\/video\//i,
    /\/watch/i,
    /\/play\//i,
    /\/v\//i,
    /\/live\//i,
    /\/embed\//i,
    /\/player\//i,
    /\/episode\//i,
    /\/track\//i,
    /\/clip\//i
  ] as const
} as const;

// ============================================
// 时间配置
// ============================================

/** 时间相关常量 (毫秒) */
export const Timing = {
  /** OSD 显示持续时间 */
  OSD_DURATION: 2000,
  /** Toast 显示持续时间 */
  TOAST_DURATION: 3000,
  /** 最近播放阈值 (用于 UI 保留判断) */
  RECENTLY_PLAYED_THRESHOLD: 60000,
  /** Capture 请求锁定时间 */
  CAPTURE_LOCK_TIME: 500,
  /** Observer 防抖时间 */
  OBSERVER_DEBOUNCE: 500,
  /** 状态重新应用间隔 */
  STATE_REAPPLY_INTERVAL: 2000,
  /** Capture 初始化延迟 */
  CAPTURE_INIT_DELAY: 300,
  /** 频谱可视化帧间隔 */
  VIZ_FRAME_INTERVAL: 32,
  /** 互斥锁轮询间隔 */
  MUTEX_POLL_INTERVAL: 50,
  /** 指标初始化循环次数 */
  METRICS_INIT_LOOPS: 20,
  /** EQ 抽屉动画延迟 */
  EQ_DRAWER_DELAY: 310
} as const;
