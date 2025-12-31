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
	try {
		const response = await fetch(`https://ipinfo.io/${ip}/json`);
		if (!response.ok) throw new Error('API error');
		return await response.json();
	} catch {
		return null;
	}
}

// Validate IP address
export function isValidIp(ip: string): boolean {
	const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
	const ipv6 = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
	if (ipv4.test(ip)) {
		return ip.split('.').every((n) => parseInt(n) <= 255);
	}
	return ipv6.test(ip);
}

// Format location
export function formatLocation(info: IpInfo): string {
	const parts = [info.city, info.region, info.country].filter(Boolean);
	return parts.join(', ') || 'Unknown';
}
