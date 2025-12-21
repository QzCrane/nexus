import {
  AudioMode as AudioModeConst,
  AudioModeType,
  DefaultRestrictedDomains,
  DefaultSiteRules,
  DefaultPreviewRules,
  UrlDetection,
  SitePlayPageRule
} from './constants.js';

import type {
  IPolicyEngine,
  PolicyContext,
  UrlInfo,
  AudioMode,
  SiteRule
} from '@nexus/contracts';

/** 策略引擎配置 */
export interface PolicyEngineConfig {
  /** 用户自定义的受限域名列表 */
  userRegistry?: string[];
  /** 自定义站点规则 (覆盖默认规则) */
  customSiteRules?: SitePlayPageRule[];
}

/**
 * 策略引擎类
 * 
 * 严格遵循契约实现，负责全站音频模式决策。
 */
export class PolicyEngine implements IPolicyEngine {
  private readonly restrictedDomains: readonly string[];
  private readonly userRegistry: string[];
  private readonly siteRules: readonly SitePlayPageRule[];
  private readonly previewRules: readonly SitePlayPageRule[];

  constructor(config: PolicyEngineConfig = {}) {
    this.restrictedDomains = DefaultRestrictedDomains;
    this.userRegistry = config.userRegistry ?? [];
    this.siteRules = config.customSiteRules ?? DefaultSiteRules;
    this.previewRules = DefaultPreviewRules;
  }

  // ============================================
  // 辅助函数
  // ============================================

  /**
   * 判断是否需要高级音频处理能力
   * 
   * 任一条件满足即返回 true：
   * - 音量超过 100%
   * - 频谱可视化开启
   * - EQ 有非零值
   * - 压缩器开启
   * - 低音增强开启
   */
  private needsAdvancedProcessing(context: PolicyContext): boolean {
    const { volume, visualizerEnabled, config } = context;

    // 音量超过 100%
    if (volume > 100) return true;

    // 频谱可视化开启
    if (visualizerEnabled) return true;

    // 以下需要完整 config 对象
    if (config) {
      // EQ 有非零值
      if (config.eqValues?.some(v => v !== 0)) return true;

      // 压缩器开启
      if (config.compressor) return true;

      // 低音增强开启
      if (config.bass) return true;
    }

    return false;
  }

  // ============================================
  // 公开方法 (契约实现)
  // ============================================

  /**
   * 计算期望的音频处理模式 (V2 简化策略)
   * 
   * 决策表:
   * | # | 页面 | 高级需求 | 受限 | 用户操作 | 模式 |
   * |---|------|---------|------|---------|------|
   * | 1 | 任意 | ❌ | 任意 | 任意 | NATIVE_LITE |
   * | 2 | 播放 | ✅ | ❌ | - | NATIVE_WEBAUDIO |
   * | 3 | 播放 | ✅ | ✅ | - | CAPTURE |
   * | 4 | 预览 | ✅ | ❌ | 任意 | NATIVE_WEBAUDIO |
   * | 5 | 预览 | ✅ | ✅ | ❌ | NATIVE_LITE |
   * | 6 | 预览 | ✅ | ✅ | ✅ | CAPTURE |
   */
  public readonly calculateMode = (context: PolicyContext): AudioMode => {
    const { urlInfo, enabled, userInteracted, forceNative } = context;

    // 禁用时退出，使用安全的原生精简模式 (🔵 蓝)
    if (!enabled) {
      return 'NATIVE_LITE';
    }

    // 核心判断: 是否有高级需求
    const needsAdvanced = this.needsAdvancedProcessing(context);

    // ========== 场景 1: 无高级需求 → NATIVE_LITE (最省 CPU) ==========
    if (!needsAdvanced) {
      return 'NATIVE_LITE';
    }

    // ========== 有高级需求的情况 ==========
    const isPlayPage = this.isVideoPlayPage(urlInfo);
    const restricted = forceNative ? false : this.isRestrictedSite(urlInfo.domain);

    // 非受限站点: 统一使用 NATIVE_WEBAUDIO (🔵 蓝)
    if (!restricted) {
      return 'NATIVE_WEBAUDIO';
    }

    // ========== 受限站点 + 有高级需求 ==========

    // 场景 3: 播放页 + 受限 → CAPTURE (🟣 紫)
    if (isPlayPage) {
      return 'CAPTURE';
    }

    // 场景 5/6: 预览页 + 受限
    // 用户未操作 → NATIVE_LITE (等待用户意图明确)
    // 用户已操作 → CAPTURE
    return userInteracted ? 'CAPTURE' : 'NATIVE_LITE';
  }

  /**
   * 判断当前 URL 是否为预览页 (而非正式播放页)
   */
  public isPreviewPage(url: UrlInfo): boolean {
    const { domain: hostname, pathname } = url;

    // 1. 根路径判断需站点特定。通用规则中不再包含强制根路径为预览页。
    // 因为像抖音这样的站点，其首页就是主播放页。
    if (pathname === '/' || pathname === '') {
      // B站和 YTB 的首页确实是预览性质（推荐墙）
      const isSearchOrHome = hostname.includes('bilibili.com') || hostname.includes('youtube.com');
      if (isSearchOrHome) return true;
    }

    // 2. 匹配显式预览规则
    for (const rule of this.previewRules) {
      if (!hostname.includes(rule.hostPattern)) continue;

      // 检查子域名 (如 search.bilibili.com)
      if (rule.liveSubdomains) {
        for (const sub of rule.liveSubdomains) {
          if (hostname.startsWith(sub + '.')) return true;
        }
      }

      // 检查路径匹配 (如 /search)
      if (rule.pathPatterns) {
        if (rule.pathPatterns.some(p => this.matchesPathPattern(pathname, p))) return true;
      }
    }

    return false;
  }

  /**
   * 判断指定域名是否为受限网站
   */
  public isRestrictedSite(domain: string): boolean {
    // 检查默认受限列表
    const inDefault = this.restrictedDomains.some(d => domain.includes(d));
    if (inDefault) return true;

    // 检查用户自定义列表
    return this.userRegistry.some(d => domain.includes(d));
  }

  /**
   * 检查域名是否在黑名单 (契约实现)
   */
  public isBlacklisted(domain: string): boolean {
    return this.isRestrictedSite(domain);
  }

  /**
   * 获取域名的特殊规则 (契约实现)
   */
  public getRuleForDomain(domain: string): SiteRule | null {
    const rule = this.siteRules.find(r => domain.includes(r.hostPattern));
    if (!rule) return null;

    return {
      type: 'force_capture', // 默认行为
      pattern: rule.hostPattern,
      reason: rule.name
    };
  }

  /**
   * 判断当前 URL 是否为视频播放页
   */
  public isVideoPlayPage(url: UrlInfo): boolean {
    // 1. 优先使用“预览页”匹配。如果匹配到预览页规则，直接排除
    if (this.isPreviewPage(url)) {
      return false;
    }

    const { domain: hostname, pathname, fullUrl } = url;

    // 解析 URL 参数 (从 fullUrl)
    let searchParams = new URLSearchParams();
    let hash = '';
    try {
      const parsed = new URL(fullUrl);
      searchParams = parsed.searchParams;
      hash = parsed.hash;
    } catch {
      // 容错
    }

    // 2. 通用 URL 参数检测 (bvid, video_id 等)
    const hasVideoParam = UrlDetection.VIDEO_PARAMS.some(p => searchParams.has(p));
    if (hasVideoParam) {
      return true;
    }

    // ========== 2. Hash 关键词检测 ==========
    if (UrlDetection.HASH_VIDEO_KEYWORDS.test(hash)) {
      return true;
    }

    // ========== 3. 网站特定规则检测 ==========
    for (const rule of this.siteRules) {
      // 检查域名是否匹配
      if (!hostname.includes(rule.hostPattern)) continue;

      // 检查是否为直播子域名（整站视为播放页）
      if (rule.liveSubdomains) {
        for (const sub of rule.liveSubdomains) {
          if (hostname.startsWith(sub + '.')) {
            return true;
          }
        }
      }

      // 检查路径匹配
      if (rule.pathPatterns) {
        if (rule.pathPatterns.some(p => this.matchesPathPattern(pathname, p))) {
          return true;
        }
      }

      // 检查正则匹配
      if (rule.pathRegex) {
        if (rule.pathRegex.some(r => r.test(pathname))) {
          return true;
        }
      }

      // 匹配到网站但路径不符合，继续尝试后续的通用检测
      break;
    }

    // ========== 4. 通用路径模式兜底 ==========
    return UrlDetection.GENERIC_PATH_PATTERNS.some(pattern => pattern.test(pathname));
  }

  // ============================================
  // 用户注册表管理
  // ============================================

  /** 添加域名到用户注册表 */
  public addToUserRegistry(domain: string): boolean {
    if (this.userRegistry.includes(domain)) return false;
    this.userRegistry.push(domain);
    return true;
  }

  /** 从用户注册表移除域名 */
  public removeFromUserRegistry(domain: string): boolean {
    const index = this.userRegistry.indexOf(domain);
    if (index === -1) return false;
    this.userRegistry.splice(index, 1);
    return true;
  }

  /** 获取用户注册表的只读副本 */
  public getUserRegistry(): readonly string[] {
    return [...this.userRegistry];
  }

  /** 设置用户注册表 (覆盖) */
  public setUserRegistry(registry: string[]): void {
    this.userRegistry.length = 0;
    this.userRegistry.push(...registry);
  }

  // ============================================
  // 辅助方法
  // ============================================

  private matchesPathPattern(pathname: string, pattern: string): boolean {
    if (pattern.endsWith('/')) {
      return pathname.startsWith(pattern);
    }
    return pathname === pattern || pathname.startsWith(pattern + '/');
  }
}
