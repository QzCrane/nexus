/**
 * 通用类型定义
 *
 * 这些是跨模块共享的基础类型工具。
 */
/**
 * 操作结果类型 - 用于明确表示成功或失败
 *
 * @example
 * ```typescript
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return { ok: false, error: '除数不能为 0' };
 *   return { ok: true, value: a / b };
 * }
 * ```
 */
export type Result<T, E = string> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: E;
};
/**
 * 可空类型
 */
export type Maybe<T> = T | null | undefined;
/**
 * 标签页 ID (防止与普通数字混淆)
 *
 * @example
 * ```typescript
 * const tabId: TabId = 12345 as TabId;
 * ```
 */
export type TabId = number & {
    readonly __brand: 'TabId';
};
/**
 * 音量值 (0-800)
 */
export type VolumeLevel = number & {
    readonly __brand: 'VolumeLevel';
};
/**
 * 域名
 */
export type DomainName = string & {
    readonly __brand: 'DomainName';
};
/**
 * 事件处理器类型
 */
export type EventHandler<T> = (data: T) => void | Promise<void>;
/**
 * 取消订阅函数
 */
export type Unsubscribe = () => void;
//# sourceMappingURL=common.types.d.ts.map