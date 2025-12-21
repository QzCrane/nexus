/**
 * NEXUS Audio Engine - 策略引擎 (v3.0)
 * 
 * 极简行为检测策略，不依赖 URL 路径规则
 */

import { DefaultRestrictedDomains } from './constants.js';

import type {
  IPolicyEngine,
  PolicyContext,
  AudioMode,
  SiteRule
} from '@nexus/contracts';

/** 策略引擎配置 */
export interface PolicyEngineConfig {
  userRegistry?: string[];
}

/**
 * 策略引擎类 (v3.0)
 * 
 * 决策规则：
 * 1. 无高级需求 → NATIVE_LITE
 * 2. 有需求 + 非受限 → NATIVE_WEBAUDIO
 * 3. 有需求 + 受限 → CAPTURE
 */
export class PolicyEngine implements IPolicyEngine {
  private readonly restrictedDomains: readonly string[];
  private readonly userRegistry: string[];

  constructor(config: PolicyEngineConfig = {}) {
    this.restrictedDomains = DefaultRestrictedDomains;
    this.userRegistry = config.userRegistry ?? [];
  }

  /**
   * 判断是否有高级音频处理需求
   */
  private needsAdvancedProcessing(context: PolicyContext): boolean {
    const { volume, visualizerEnabled, config } = context;
    if (volume > 100) return true;
    if (visualizerEnabled) return true;
    if (config) {
      if (config.eqValues?.some(v => v !== 0)) return true;
      if (config.compressor) return true;
      if (config.bass) return true;
    }
    return false;
  }

  /**
   * 计算音频处理模式
   */
  public readonly calculateMode = (context: PolicyContext): AudioMode => {
    const { enabled, forceNative, urlInfo } = context;

    if (!enabled) return 'NATIVE_LITE';
    if (!this.needsAdvancedProcessing(context)) return 'NATIVE_LITE';

    const restricted = forceNative ? false : this.isRestrictedSite(urlInfo.domain);
    return restricted ? 'CAPTURE' : 'NATIVE_WEBAUDIO';
  }

  /** 判断是否为受限站点 */
  public isRestrictedSite(domain: string): boolean {
    const inDefault = this.restrictedDomains.some(d => domain.includes(d));
    if (inDefault) return true;
    return this.userRegistry.some(d => domain.includes(d));
  }

  /** 别名 */
  public isBlacklisted(domain: string): boolean {
    return this.isRestrictedSite(domain);
  }

  /** @deprecated v3.0 不使用 */
  public getRuleForDomain(_domain: string): SiteRule | null {
    return null;
  }

  // 用户注册表管理
  public addToUserRegistry(domain: string): boolean {
    if (this.userRegistry.includes(domain)) return false;
    this.userRegistry.push(domain);
    return true;
  }

  public removeFromUserRegistry(domain: string): boolean {
    const index = this.userRegistry.indexOf(domain);
    if (index === -1) return false;
    this.userRegistry.splice(index, 1);
    return true;
  }

  public getUserRegistry(): readonly string[] {
    return [...this.userRegistry];
  }

  public setUserRegistry(registry: string[]): void {
    this.userRegistry.length = 0;
    this.userRegistry.push(...registry);
  }
}
