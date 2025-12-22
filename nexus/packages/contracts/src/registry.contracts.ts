/**
 * 受限域名注册表契约
 * 
 * v3.1: 用户编辑 + CORS 自动检测（无默认列表）
 */

/** 域名来源 */
export type DomainSource = 'user' | 'auto';

/** 域名条目 */
export interface DomainEntry {
	/** 域名 (如 douyin.com) */
	domain: string;
	/** 来源 */
	source: DomainSource;
	/** 已预检测 CORS */
	probed: boolean;
	/** 检测结果: true=受限, false=安全, undefined=未检测 */
	restricted?: boolean;
	/** 添加时间 (用于排序/清理) */
	addedAt?: number;
}

/** 注册表存储格式 (兼容处理在 kernel 层) */
export type RegistryStorage = DomainEntry[] | string[];

/** 注册表操作结果 */
export interface RegistryResult {
	success: boolean;
	reason?: string;
	entry?: DomainEntry;
}
