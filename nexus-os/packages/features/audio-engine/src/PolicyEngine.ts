/**
 * NEXUS Audio Engine - 策略引擎 (Policy Engine)
 * 
 * 从原 VolumeBooster content.js 迁移，负责决定音频处理模式。
 * 
 * 核心职责：
 * 1. 判断当前网站是否为受限网站 (CORS 限制)
 * 2. 判断当前页面是否为播放页 (vs 推荐页/首页)
 * 3. 根据用户状态和设置计算期望的音频处理模式
 * 
 * 这是一个纯逻辑模块，不依赖 DOM，方便单元测试。
 */

import {
  AudioMode,
  AudioModeType,
  DefaultRestrictedDomains,
  DefaultSiteRules,
  UrlDetection,
  SitePlayPageRule
} from './constants.js';

// ============================================
// 类型定义
// ============================================

/** 策略引擎配置 */
export interface PolicyEngineConfig {
  /** 用户自定义的受限域名列表 */
  userRegistry?: string[];
  /** 自定义站点规则 (覆盖默认规则) */
  customSiteRules?: SitePlayPageRule[];
}

/** 策略计算上下文 */
export interface PolicyContext {
  /** 音频增强是否启用 */
  enabled: boolean;
  /** 当前音量 (0-800) */
  volume: number;
  /** 频谱可视化是否开启 */
  visualizerEnabled: boolean;
  /** 用户是否已通过 UI 或快捷键交互过 */
  userHasInteracted: boolean;
}

/** URL 信息 (用于策略计算) */
export interface UrlInfo {
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
}

// ============================================
// 策略引擎实现
// ============================================

/**
 * 策略引擎类
 * 
 * 用法:
 * ```typescript
 * const engine = new PolicyEngine({ userRegistry: ['example.com'] });
 * 
 * const mode = engine.calculateDesiredMode(
 *   { hostname: 'youtube.com', pathname: '/watch', ... },
 *   { enabled: true, volume: 150, visualizerEnabled: true, userHasInteracted: true }
 * );
 * // => 'NATIVE_WEBAUDIO'
 * ```
 */
export class PolicyEngine {
  private readonly restrictedDomains: readonly string[];
  private readonly userRegistry: string[];
  private readonly siteRules: readonly SitePlayPageRule[];

  constructor(config: PolicyEngineConfig = {}) {
    this.restrictedDomains = DefaultRestrictedDomains;
    this.userRegistry = config.userRegistry ?? [];
    this.siteRules = config.customSiteRules ?? DefaultSiteRules;
  }

  // ============================================
  // 公开方法
  // ============================================

  /**
   * 计算期望的音频处理模式
   * 
   * 完整策略逻辑 (从原 content.js 迁移):
   * 
   * 【推荐页预览场景】(isVideoPlayPage = false)
   * - 用户未交互：原生模式（非受限=NATIVE_WEBAUDIO，受限=NATIVE_LITE）
   * - 用户已交互：全音量劫持模式（CAPTURE）- 所有网站统一
   * 
   * 【播放页场景】(isVideoPlayPage = true，无论用户是否交互)
   * - 跨域不限制网站：全音量原生模式（NATIVE_WEBAUDIO）
   * - 跨域限制网站：
   *   - 频谱开：全音量劫持模式（CAPTURE）
   *   - 频谱关：音量 > 100 → CAPTURE；音量 ≤ 100 → NATIVE_LITE
   */
  calculateDesiredMode(url: UrlInfo, context: PolicyContext): AudioModeType {
    // 禁用时使用安全的精简模式
    if (!context.enabled) {
      return AudioMode.NATIVE_LITE;
    }

    const restricted = this.isRestrictedSite(url.hostname);
    const isPlayPage = this.isVideoPlayPage(url);

    if (isPlayPage) {
      // ========== 播放页逻辑 ==========
      if (!restricted) {
        // 非受限网站：全音量原生模式
        return AudioMode.NATIVE_WEBAUDIO;
      } else {
        // 受限网站
        if (context.visualizerEnabled) {
          // 频谱开：全音量劫持模式
          return AudioMode.CAPTURE;
        } else {
          // 频谱关：根据音量决定
          if (context.volume > 100) {
            return AudioMode.CAPTURE;
          }
          return AudioMode.NATIVE_LITE;
        }
      }
    } else {
      // ========== 推荐页预览逻辑 ==========
      if (!context.userHasInteracted) {
        // 用户未交互：默认原生模式（节省资源）
        return restricted ? AudioMode.NATIVE_LITE : AudioMode.NATIVE_WEBAUDIO;
      } else {
        // 用户已交互：全部使用劫持模式
        // 推荐页预览视频可能无法被原生模式控制
        return AudioMode.CAPTURE;
      }
    }
  }

  /**
   * 判断指定域名是否为受限网站
   */
  isRestrictedSite(hostname: string): boolean {
    // 检查默认受限列表
    const inDefault = this.restrictedDomains.some(d => hostname.includes(d));
    if (inDefault) return true;

    // 检查用户自定义列表
    return this.userRegistry.some(d => hostname.includes(d));
  }

  /**
   * 判断当前 URL 是否为视频播放页
   * 
   * 检测优先级:
   * 1. URL 参数检测 (如 modal_id, v 等)
   * 2. Hash 关键词检测
   * 3. 网站特定规则检测
   * 4. 通用路径模式兜底
   */
  isVideoPlayPage(url: UrlInfo): boolean {
    const { hostname, pathname, search, hash } = url;

    // ========== 1. 通用 URL 参数检测 ==========
    const urlParams = new URLSearchParams(search);
    const hasVideoParam = UrlDetection.VIDEO_PARAMS.some(p => urlParams.has(p));
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
        if (rule.pathPatterns.some(p => pathname.includes(p))) {
          return true;
        }
      }

      // 检查正则匹配
      if (rule.pathRegex) {
        if (rule.pathRegex.some(r => r.test(pathname))) {
          return true;
        }
      }

      // 匹配到网站但路径不符合，直接返回 false
      return false;
    }

    // ========== 4. 通用路径模式兜底 ==========
    // 首页/推荐页通常是根路径，排除
    if (pathname === '/' || pathname === '') {
      return false;
    }

    return UrlDetection.GENERIC_PATH_PATTERNS.some(pattern => pattern.test(pathname));
  }

  // ============================================
  // 用户注册表管理
  // ============================================

  /**
   * 添加域名到用户注册表
   */
  addToUserRegistry(domain: string): boolean {
    // 检查是否已存在
    if (this.userRegistry.includes(domain)) {
      return false;
    }
    this.userRegistry.push(domain);
    return true;
  }

  /**
   * 从用户注册表移除域名
   */
  removeFromUserRegistry(domain: string): boolean {
    const index = this.userRegistry.indexOf(domain);
    if (index === -1) {
      return false;
    }
    this.userRegistry.splice(index, 1);
    return true;
  }

  /**
   * 获取用户注册表的只读副本
   */
  getUserRegistry(): readonly string[] {
    return [...this.userRegistry];
  }

  /**
   * 设置用户注册表 (覆盖)
   */
  setUserRegistry(registry: string[]): void {
    this.userRegistry.length = 0;
    this.userRegistry.push(...registry);
  }
}
