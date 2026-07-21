// goal: comprehensive SSRF guard blocking private/internal/loopback/link-local hosts
// eff: Extracted from background.ts to cover IPv6 ULA/link-local, IPv4-mapped IPv6,
//      0.0.0.0, CGN 100.64.0.0/10, TEST-NET ranges, and decimal/hex IP representations.

const PRIVATE_IPV4_PATTERNS = [
	/^0\./,                          // 0.0.0.0/8
	/^10\./,                         // 10.0.0.0/8
	/^127\./,                        // 127.0.0.0/8
	/^169\.254\./,                   // 169.254.0.0/16 link-local
	/^172\.(1[6-9]|2\d|3[01])\./,    // 172.16.0.0/12
	/^192\.0\.2\./,                  // 192.0.2.0/24 TEST-NET-1
	/^192\.168\./,                   // 192.168.0.0/16
	/^198\.(1[8-9]|[2-9]\d|1\d\d)\./,// 198.18.0.0/15 benchmark
	/^198\.51\.100\./,               // 198.51.100.0/24 TEST-NET-2
	/^203\.0\.113\./,                // 203.0.113.0/24 TEST-NET-3
	/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // 100.64.0.0/10 CGN
];

function isPrivateIPv4(host: string): boolean {
	// Reject decimal/hex/octal IP representations by parsing to integer
	if (/^\d+$/.test(host)) {
		const num = Number(host);
		if (!Number.isSafeInteger(num) || num < 0 || num > 0xFFFFFFFF) return true;
		const octets = [(num >>> 24) & 0xFF, (num >>> 16) & 0xFF, (num >>> 8) & 0xFF, num & 0xFF];
		const dotted = octets.join('.');
		return PRIVATE_IPV4_PATTERNS.some(re => re.test(dotted));
	}
	if (/^0x[0-9a-f]+$/i.test(host)) return true;  // hex form
	return PRIVATE_IPV4_PATTERNS.some(re => re.test(host));
}

function isPrivateIPv6(host: string): boolean {
	const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
	// IPv4-mapped IPv6 (::ffff:x.x.x.x)
	const mappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	const mappedIpv4 = mappedMatch?.[1];
	if (mappedIpv4) return isPrivateIPv4(mappedIpv4);
	return normalized === '::1'              // loopback
		|| normalized === '::'              // unspecified
		|| normalized.startsWith('fc')      // ULA fc00::/7
		|| normalized.startsWith('fd')      // ULA fc00::/7
		|| normalized.startsWith('fe80')    // link-local
		|| normalized.startsWith('fe9')     // link-local fe80::/10
		|| normalized.startsWith('fea')     // link-local
		|| normalized.startsWith('feb');    // link-local
}

export function isPrivateHost(host: string): boolean {
	if (!host) return true;
	const lower = host.toLowerCase();
	if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
	if (lower === 'metadata.google.internal') return true;
	if (lower.endsWith('.internal') || lower.endsWith('.local')) return true;
	if (lower.includes(':')) return isPrivateIPv6(lower);
	return isPrivateIPv4(lower);
}
