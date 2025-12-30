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
];
