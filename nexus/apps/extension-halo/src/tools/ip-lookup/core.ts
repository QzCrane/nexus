// goal: IP Lookup core logic - query IP information

import type { IpInfo } from './types';

// Get current IP info (using free API)
export async function getMyIpInfo(): Promise<IpInfo | null> {
	try {
		const response = await fetch('https://ipinfo.io/json');
		if (!response.ok) throw new Error('API error');
		return await response.json();
	} catch {
		// Fallback to IP only
		try {
			const r = await fetch('https://api.ipify.org?format=json');
			const data = await r.json();
			return { ip: data.ip };
		} catch {
			return null;
		}
	}
}

// Lookup specific IP
export async function lookupIp(ip: string): Promise<IpInfo | null> {
	// rule: validate input before constructing URL — without this, a malformed `ip`
	// (e.g. `../some/path`) could be path-injected into the ipinfo.io URL.
	if (!isValidIp(ip)) return null;
	const safeIp = encodeURIComponent(ip);
	try {
		const response = await fetch(`https://ipinfo.io/${safeIp}/json`);
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
