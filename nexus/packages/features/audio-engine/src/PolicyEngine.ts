import {
  DefaultRestrictedDomains,
  DefaultSiteRules,
  SitePlayPageRule
} from './constants.js';

import type {
  IPolicyEngine,
  PolicyContext,
  AudioMode,
  SiteRule
} from '@nexus/contracts';

/** 策略引擎配置 */
export interface PolicyEngineConfig {
  /** 用户自定义的受限域名列表 */
  userRegistry?: string[];
}

/**
 * 策略引擎类 (v3.0 极简版)
 * 
 * 决策规则：
 * 1. 无高级需求 → NATIVE_LITE
 * 2. 有需求 + 非受限 → NATIVE_WEBAUDIO
 * 3. 有需求 + 受限 → CAPTURE
 */
export class PolicyEngine implements IPolicyEngine {
  private readonly restrictedDomains: readonly string[];
  private readonly userRegistry: string[];
  private readonly siteRules: readonly SitePlayPageRule[]; // 保留用于 getRuleForDomain

  constructor(config: PolicyEngineConfig = {}) {
    this.restrictedDomains = DefaultRestrictedDomains;
    this.userRegistry = config.userRegistry ?? [];
    this.siteRules = DefaultSiteRules;
  }

  // ============================================
  // 辅助函数
  // ============================================

  /**
   * 判断是否需要高级音频处理能力
   * 
   * 逻辑与 color-predictor.needsAdvancedProcessing 相同，
   * 但接口不同（使用 PolicyContext 而非 ColorContext）
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
   * 计算期望的音频处理模式 (v3.0 极简策略)
   * 
   * 决策表：
   * | # | 高级需求 | 受限站点 | 模式 |
   * |---|---------|---------|------|
   * | 1 | ❌ | 任意 | NATIVE_LITE |
   * | 2 | ✅ | ❌ | NATIVE_WEBAUDIO |
   * | 3 | ✅ | ✅ | CAPTURE |
   * 
   * 高级需求 = 音量>100% || 频谱开 || EQ非零 || 压缩器 || 低音
   */
  public readonly calculateMode = (context: PolicyContext): AudioMode => {
    const { enabled, forceNative, urlInfo } = context;

    // 禁用时使用安全模式
    if (!enabled) {
      return 'NATIVE_LITE';
    }

    // 规则1: 无高级需求 → NATIVE_LITE (最省 CPU)
    if (!this.needsAdvancedProcessing(context)) {
      return 'NATIVE_LITE';
    }

    // 规则2: 有需求 + 非受限 → NATIVE_WEBAUDIO
    const restricted = forceNative ? false : this.isRestrictedSite(urlInfo.domain);
    if (!restricted) {
      return 'NATIVE_WEBAUDIO';
    }

    // 规则3: 有需求 + 受限 → CAPTURE
    return 'CAPTURE';
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
   * @deprecated v3.0 不再使用播放页规则
   */
  public getRuleForDomain(domain: string): SiteRule | null {
    const rule = this.siteRules.find(r => domain.includes(r.hostPattern));
    if (!rule) return null;

    return {
      type: 'force_capture',
      pattern: rule.hostPattern,
      reason: rule.name
    };
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
    // 特殊处理根路径：只有精确匹配 '/' 或空路径时才匹配
    if (pattern === '/') {
      return pathname === '/' || pathname === '';
    }
    if (pattern.endsWith('/')) {
      return pathname.startsWith(pattern);
    }
    return pathname === pattern || pathname.startsWith(pattern + '/');
  }
}
