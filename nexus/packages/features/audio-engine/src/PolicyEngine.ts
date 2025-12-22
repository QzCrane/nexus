/**
 * NEXUS Audio Engine - 策略引擎 (v3.2)
 * 
 * 纯策略计算，受限判断由调用方通过 context.isRestricted 传入
 */

import type {
  IPolicyEngine,
  PolicyContext,
  AudioMode,
  SiteRule
} from '@nexus/contracts';

/**
 * 策略引擎类 (v3.2 - 纯计算，无状态)
 * 
 * 决策规则：
 * 1. 无高级需求 → NATIVE_LITE
 * 2. 有需求 + 非受限 → NATIVE_WEBAUDIO
 * 3. 有需求 + 受限 → CAPTURE
 * 
 * 受限判断数据源：调用方传入 context.isRestricted (来自 internalState.corsStatus)
 */
export class PolicyEngine implements IPolicyEngine {
  /** 判断是否有高级音频处理需求 */
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

  /** 计算音频处理模式 */
  public readonly calculateMode = (context: PolicyContext): AudioMode => {
    const { enabled, forceNative, isRestricted } = context;

    if (!enabled) return 'NATIVE_LITE';
    if (!this.needsAdvancedProcessing(context)) return 'NATIVE_LITE';

    // forceNative 优先级最高；否则使用调用方传入的 isRestricted
    const restricted = forceNative ? false : (isRestricted ?? false);
    return restricted ? 'CAPTURE' : 'NATIVE_WEBAUDIO';
  }

  /** @deprecated v3.0 不使用 */
  public getRuleForDomain(_domain: string): SiteRule | null {
    return null;
  }
}
