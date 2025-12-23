/**
 * NEXUS Audio Engine - 策略引擎 (v3.5)
 * 
 * 纯策略计算，受限判断由调用方通过 context.isRestricted 传入
 * 
 * v3.5 新增：延迟激活策略
 * - 用户未操作 + 音量 0-100% → 始终 NATIVE_LITE (节省 CPU)
 * - 用户打开 Popup 或快捷键后 → 正常策略生效
 */

import type {
  IPolicyEngine,
  PolicyContext,
  AudioMode,
  SiteRule
} from '@nexus/contracts';

/**
 * 策略引擎类 (v3.5)
 * 
 * 决策规则：
 * 1. 未交互 + 音量正常 → NATIVE_LITE (延迟激活)
 * 2. 无高级需求 → NATIVE_LITE
 * 3. 有需求 + 非受限 → NATIVE_WEBAUDIO
 * 4. 有需求 + 受限 → CAPTURE
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
    const { enabled, forceNative, isRestricted, userInteracted, volume } = context;

    if (!enabled) return 'NATIVE_LITE';

    // 延迟激活：用户未操作 + 音量正常 (0-100%) → 保持原生模式节省 CPU
    // 即使站点需要劫持，也延迟到用户操作后再启动
    if (!userInteracted && volume <= 100) {
      return 'NATIVE_LITE';
    }

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

