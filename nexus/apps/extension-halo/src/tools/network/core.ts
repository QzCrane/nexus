// goal: Network utility core logic (UA parsing, Curl conversion)

import type { ToolStateCodec } from '../../kernel/core/storage-codec';
import type { UAResult, CurlParseResult, NetworkMode } from './types';

export const curlLanguageCodec: ToolStateCodec<'js' | 'python'> = {
	decode(value) { return value === 'js' || value === 'python' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Curl output language must be JavaScript or Python.' }; },
	encode(value) { return value; },
};

export const networkModeCodec: ToolStateCodec<NetworkMode> = {
	decode(value) { return value === 'ua-parser' || value === 'curl-converter' ? { kind: 'valid', value } : { kind: 'invalid', reason: 'Network tool mode is invalid.' }; },
	encode(value) { return value; },
};

// === User-Agent Parser (regex-based, no external deps) ===

const UA_PATTERNS = {
	browser: [
		{ name: 'Chrome', pattern: /Chrome\/(\d+[.\d]*)/ },
		{ name: 'Firefox', pattern: /Firefox\/(\d+[.\d]*)/ },
		{ name: 'Safari', pattern: /Version\/(\d+[.\d]*).*Safari/ },
		{ name: 'Edge', pattern: /Edg\/(\d+[.\d]*)/ },
		{ name: 'Opera', pattern: /OPR\/(\d+[.\d]*)/ },
		{ name: 'IE', pattern: /MSIE (\d+[.\d]*)/ },
	],
	os: [
		{ name: 'Windows 11', pattern: /Windows NT 10\.0.*Win64/ },
		{ name: 'Windows 10', pattern: /Windows NT 10\.0/ },
		{ name: 'Windows 8.1', pattern: /Windows NT 6\.3/ },
		{ name: 'Windows 7', pattern: /Windows NT 6\.1/ },
		{ name: 'macOS', pattern: /Mac OS X (\d+[_.\d]*)/ },
		{ name: 'iOS', pattern: /iPhone OS (\d+[_.\d]*)/ },
		{ name: 'Android', pattern: /Android (\d+[.\d]*)/ },
		{ name: 'Linux', pattern: /Linux/ },
	],
	device: [
		{ type: 'Mobile', pattern: /Mobile|iPhone|Android.*Mobile/ },
		{ type: 'Tablet', pattern: /iPad|Android(?!.*Mobile)/ },
		{ type: 'Desktop', pattern: /.*/ },
	],
};

export function parseUserAgent(ua: string): UAResult {
	const result: UAResult = {
		browser: { name: 'Unknown', version: '' },
		os: { name: 'Unknown', version: '' },
		device: { type: 'Desktop', vendor: '', model: '' },
		engine: { name: '', version: '' },
	};

	// Parse browser
	for (const { name, pattern } of UA_PATTERNS.browser) {
		const match = ua.match(pattern);
		if (match) {
			result.browser = { name, version: match[1] || '' };
			break;
		}
	}

	// Parse OS
	for (const { name, pattern } of UA_PATTERNS.os) {
		const match = ua.match(pattern);
		if (match) {
			result.os = { name, version: (match[1] || '').replace(/_/g, '.') };
			break;
		}
	}

	// Parse device type
	for (const { type, pattern } of UA_PATTERNS.device) {
		if (pattern.test(ua)) {
			result.device.type = type;
			break;
		}
	}

	// Parse engine
	const webkitMatch = ua.match(/AppleWebKit\/(\d+[.\d]*)/);
	const geckoMatch = ua.match(/Gecko\/(\d+)/);
	if (webkitMatch) result.engine = { name: 'WebKit', version: webkitMatch[1] ?? '' };
	else if (geckoMatch) result.engine = { name: 'Gecko', version: geckoMatch[1] ?? '' };

	return result;
}

// === Curl Parser ===

export function parseCurl(curlCommand: string): CurlParseResult {
	const result: CurlParseResult = { method: 'GET', url: '', headers: {} };

	// Extract URL (quoted or unquoted)
	const urlMatch = curlCommand.match(/curl\s+(?:['"]([^'"]+)['"]|(\S+))/);
	if (urlMatch) result.url = urlMatch[1] || urlMatch[2] || '';

	// Extract method
	const methodMatch = curlCommand.match(/-X\s+['"]?(\w+)['"]?/);
	if (methodMatch?.[1]) result.method = methodMatch[1].toUpperCase();

	// Extract headers
	const headerMatches = curlCommand.matchAll(/-H\s+['"]([^'"]+)['"]/g);
	for (const match of headerMatches) {
		const header = match[1];
		if (!header) continue;
		const [key, ...valueParts] = header.split(':');
		if (key) result.headers[key.trim()] = valueParts.join(':').trim();
	}

	// Extract data
	const dataMatch = curlCommand.match(/(?:-d|--data(?:-raw)?)\s+['"]([^'"]+)['"]/);
	if (dataMatch) {
		result.data = dataMatch[1];
		if (result.method === 'GET') result.method = 'POST';
	}

	return result;
}

// === Code Generators ===

export function generateJS(parsed: CurlParseResult): string {
	const opts: string[] = [`  method: '${parsed.method}'`];
	if (Object.keys(parsed.headers).length) {
		opts.push(`  headers: ${JSON.stringify(parsed.headers, null, 4).replace(/\n/g, '\n  ')}`);
	}
	if (parsed.data) opts.push(`  body: '${parsed.data}'`);
	return `fetch('${parsed.url}', {\n${opts.join(',\n')}\n});`;
}

export function generatePython(parsed: CurlParseResult): string {
	const lines = ['import requests', ''];
	const args = [`'${parsed.url}'`];
	if (Object.keys(parsed.headers).length) {
		lines.push(`headers = ${JSON.stringify(parsed.headers, null, 4)}`);
		args.push('headers=headers');
	}
	if (parsed.data) {
		lines.push(`data = '${parsed.data}'`);
		args.push('data=data');
	}
	lines.push(`response = requests.${parsed.method.toLowerCase()}(${args.join(', ')})`);
	return lines.join('\n');
}
