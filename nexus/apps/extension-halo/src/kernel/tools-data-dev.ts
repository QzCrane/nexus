// goal: Developer Tools Data
// eff: Split from tools-data.ts

import type { ToolMeta } from './tool-registry-types';

export const TOOLS_DEV: ToolMeta[] = [
	{
		id: 'json-formatter',
		icon: '{}',
		category: 'dev',
		status: 'ready',
		keywords: ['json', 'format', 'geshihua', '格式化', '美化'],
	},
	{
		id: 'regex',
		icon: '.*',
		category: 'dev',
		status: 'ready',
		keywords: ['regex', 'regexp', 'regular', 'zhengze', '正则'],
	},
	{
		id: 'base64',
		icon: '🔐',
		category: 'dev',
		status: 'ready',
		keywords: ['base64', 'encode', 'decode', 'bianma', '编码', '解码'],
	},
	{
		id: 'hash',
		icon: '#️⃣',
		category: 'dev',
		status: 'ready',
		keywords: ['hash', 'md5', 'sha', 'crypto', 'haxi', '哈希'],
	},
	{
		id: 'uuid',
		icon: '🆔',
		category: 'dev',
		status: 'ready',
		keywords: ['uuid', 'ulid', 'guid', 'id'],
	},
	{
		id: 'timestamp',
		icon: '⏰',
		category: 'dev',
		status: 'ready',
		keywords: ['time', 'date', 'timestamp', 'shijian', '时间戳'],
	},
	{
		id: 'url',
		icon: '🔗',
		category: 'dev',
		status: 'ready',
		keywords: ['url', 'encode', 'decode', 'param', 'wangzhi', '网址'],
	},
	{
		id: 'crypto',
		icon: '🔐',
		category: 'dev',
		status: 'ready',
		keywords: ['crypto', 'encrypt', 'decrypt', 'jiami', '加密', '解密'],
	},
	{
		id: 'network',
		icon: '🌐',
		category: 'dev',
		status: 'ready',
		keywords: ['network', 'ua', 'curl', 'ip', 'wangluo', '网络'],
	},
	{
		id: 'mock-data',
		icon: '🎲',
		category: 'dev',
		status: 'ready',
		keywords: ['mock', 'data', 'faker', 'shuju', '数据', '模拟'],
	},
	{
		id: 'userscripts',
		icon: '📜',
		category: 'dev',
		status: 'ready',
		keywords: ['script', 'inject', 'javascript', 'js', 'jiaoben', '脚本'],
		features: { contentScript: true },
	},
	{
		id: 'yaml',
		icon: 'Y',
		category: 'dev',
		status: 'ready',
		keywords: ['yaml', 'json', 'convert', 'zhuanhuan', '格式'],
	},
	{
		id: 'diff',
		icon: '⚖️',
		category: 'dev',
		status: 'ready',
		keywords: ['diff', 'compare', 'text', 'duibi', '对比', '差异'],
	},
	{
		id: 'number-base',
		icon: '🔢',
		category: 'dev',
		status: 'ready',
		keywords: ['number', 'binary', 'hex', 'decimal', 'jinzhi', '进制'],
	},
	{
		id: 'text-tools',
		icon: '📝',
		category: 'dev',
		status: 'ready',
		keywords: ['text', 'case', 'sort', 'lines', 'wenben', '文本'],
	},
];
