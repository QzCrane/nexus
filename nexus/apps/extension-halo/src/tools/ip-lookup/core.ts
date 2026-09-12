// goal: IP Lookup core logic - query IP information

import type { IpInfo } from './types';
import type { ToolStateCodec } from '../../kernel/core/storage-codec';

const IP_INFO_FIELDS = ['ip', 'hostname', 'city', 'region', 'country', 'loc', 'org', 'timezone'] as const;
export const ipInfoCodec: ToolStateCodec<IpInfo | null> = {
	decode(value) {
		if (value === null) return { kind: 'valid', value: null };
		if (typeof value !== 'object' || Array.isArray(value)) return { kind: 'invalid', reason: 'Stored IP information is not a record.' };
		const row = value as Record<string, unknown>;
		if (typeof row.ip !== 'string' || row.ip.length > 128 || IP_INFO_FIELDS.some((key) => row[key] !== undefined && (typeof row[key] !== 'string' || (row[key] as string).length > 512))) {
			return { kind: 'invalid', reason: 'Stored IP information has invalid or oversized fields.' };
		}
		return { kind: 'valid', value: Object.fromEntries(IP_INFO_FIELDS.flatMap((key) => row[key] === undefined ? [] : [[key, row[key]]])) as unknown as IpInfo };
	},
	encode: (value) => value,
};

// Get current IP info (using free API)
export async function getMyIpInfo(signal?: AbortSignal): Promise<IpInfo | null> {
	try {
		const response = await fetch('https://ipinfo.io/json', { signal });
		if (!response.ok) throw new Error('API error');
		return await response.json();
	} catch {
		// Fallback to IP only
		try {
			const r = await fetch('https://api.ipify.org?format=json', { signal });
			const data = await r.json();
			return { ip: data.ip };
		} catch {
			return null;
		}
	}
}

// Lookup specific IP
export async function lookupIp(ip: string, signal?: AbortSignal): Promise<IpInfo | null> {
	// rule: validate input before constructing URL — without this, a malformed `ip`
	// (e.g. `../some/path`) could be path-injected into the ipinfo.io URL.
	if (!isValidIp(ip)) return null;
	const safeIp = encodeURIComponent(ip);
	try {
		const response = await fetch(`https://ipinfo.io/${safeIp}/json`, { signal });
		if (!response.ok) throw new Error('API error');
		return await response.json();
	} catch {
		return null;
	}
}

// Validate IP address
export function isValidIp(ip: string): boolean {
	// IPv4
	const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
	if (ipv4.test(ip)) {
		return ip.split('.').every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
	}
	// rule: IPv6 — use URL parsing instead of a regex. The previous regex
	// `^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$` only matched the fully-expanded
	// form and rejected all valid abbreviated forms (::1, fe80::1, 2001:db8::1, etc.).
	// Wrapping in brackets forces URL to parse the host as an IPv6 literal per RFC 3986.
	try {
		new URL(`http://[${ip}]/`);
		return true;
	} catch {
		return false;
	}
}

// Format location
export function formatLocation(info: IpInfo): string {
	const parts = [info.city, info.region, info.country].filter(Boolean);
	return parts.join(', ') || 'Unknown';
}
