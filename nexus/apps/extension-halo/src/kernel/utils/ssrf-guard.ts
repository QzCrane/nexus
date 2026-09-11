// goal: comprehensive SSRF guard blocking private/internal/loopback/link-local hosts
// eff: Extracted from background.ts to cover IPv6 ULA/link-local, IPv4-mapped IPv6,
//      0.0.0.0, CGN 100.64.0.0/10, TEST-NET ranges, and decimal/hex/octal IP
//      representations. Only true IP literals are pattern-matched: a hostname
//      that merely starts with numeric text is never blocked on that basis, and
//      literal-shaped hosts that fail to parse are treated as private (fail closed).

const PRIVATE_IPV4_PATTERNS = [
	/^0\./,                          // 0.0.0.0/8
	/^10\./,                         // 10.0.0.0/8
	/^127\./,                        // 127.0.0.0/8
	/^169\.254\./,                   // 169.254.0.0/16 link-local
	/^172\.(1[6-9]|2\d|3[01])\./,    // 172.16.0.0/12
	/^192\.0\.2\./,                  // 192.0.2.0/24 TEST-NET-1
	/^192\.168\./,                   // 192.168.0.0/16
	/^198\.(1[8-9])\./,              // 198.18.0.0/15 benchmark
	/^198\.51\.100\./,               // 198.51.100.0/24 TEST-NET-2
	/^203\.0\.113\./,                // 203.0.113.0/24 TEST-NET-3
	/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./, // 100.64.0.0/10 CGN
];

/**
 * Parse a numeric host as an IPv4 literal using the classic inet_aton forms:
 * 1-4 dot-separated parts, each decimal, 0x-hex, or leading-0 octal. Short
 * forms pad with zeros (127.1 is 127.0.0.1). Returns null for hosts that are
 * not numeric literals and an empty array for literal-shaped hosts that
 * cannot be parsed (fail closed).
 */
function parseIpv4Literal(hostWithDot: string): number[] | null {
	// One trailing dot is the FQDN form of the same literal (1.2.3.4.).
	const host = hostWithDot.endsWith('.') && !hostWithDot.endsWith('..') ? hostWithDot.slice(0, -1) : hostWithDot;
	if (!host) return null;
	const parts = host.split('.');
	if (parts.length > 4) return null;
	const values: number[] = [];
	for (const part of parts) {
		if (part === '') return null;
		let value: number;
		if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
			value = Number.parseInt(part, 16);
		} else if (/^\d+$/.test(part)) {
			if (part.length > 1 && part.startsWith('0')) {
				// WHATWG octal form. A digit outside 0-7 means literal-shaped
				// garbage that fails URL parsing; fail closed.
				if (!/^[0-7]+$/.test(part)) return [];
				value = Number.parseInt(part, 8);
			} else value = Number.parseInt(part, 10);
		} else {
			// A non-numeric part means this was never an IP literal.
			return null;
		}
		if (!Number.isSafeInteger(value) || value < 0 || value > 0xFFFFFFFF) return [];
		values.push(value);
	}
	const first = values[0] ?? 0;
	if (values.length === 1) return [(first >>> 24) & 0xFF, (first >>> 16) & 0xFF, (first >>> 8) & 0xFF, first & 0xFF];
	const second = values[1] ?? 0;
	if (values.length === 2) return [first, (second >>> 16) & 0xFF, (second >>> 8) & 0xFF, second & 0xFF];
	const third = values[2] ?? 0;
	if (values.length === 3) return [first, second, (third >>> 8) & 0xFF, third & 0xFF];
	for (const value of values) if (value > 255) return [];
	return values;
}

function isPrivateIpv4Octets(octets: number[]): boolean {
	const dotted = octets.join('.');
	return PRIVATE_IPV4_PATTERNS.some((re) => re.test(dotted));
}

function isPrivateIPv4(host: string): boolean {
	// Whole-host decimal form (2130706433).
	if (/^\d+$/.test(host)) {
		const num = Number(host);
		if (!Number.isSafeInteger(num) || num < 0 || num > 0xFFFFFFFF) return true;
		return isPrivateIpv4Octets([(num >>> 24) & 0xFF, (num >>> 16) & 0xFF, (num >>> 8) & 0xFF, num & 0xFF]);
	}
	const octets = parseIpv4Literal(host);
	if (octets !== null) {
		// Unparseable literal-shaped hosts fail closed; parsed literals are
		// evaluated on their numeric value, so short/octal/hex forms cannot
		// slip past the prefix patterns.
		return octets.length === 0 ? true : isPrivateIpv4Octets(octets);
	}
	// A real hostname (10.0.0.1.com, 127.evil.test) is never blocked here:
	// name-based filtering cannot know what it resolves to.
	return false;
}

function isPrivateIPv6(host: string): boolean {
	const withoutZone = host.split('%')[0] ?? host;
	const normalized = withoutZone.replace(/^\[|\]$/g, '').toLowerCase();
	// IPv4-mapped IPv6 (::ffff:127.0.0.1 and ::ffff:7f00:1)
	const mappedDotted = normalized.match(/^::ffff:(\S+)$/);
	const mapped = mappedDotted?.[1];
	if (mapped) {
		if (mapped.includes(':')) {
			const groups = mapped.split(':');
			if (groups.length === 2) {
				const high = Number.parseInt(groups[0] ?? '', 16);
				const low = Number.parseInt(groups[1] ?? '', 16);
				if (Number.isNaN(high) || Number.isNaN(low)) return true;
				return isPrivateIpv4Octets([high >>> 8, high & 0xFF, low >>> 8, low & 0xFF]);
			}
			return true;
		}
		return isPrivateIPv4(mapped);
	}
	return normalized === '::1'              // loopback
		|| normalized === '::'              // unspecified
		|| normalized.startsWith('fc')      // ULA fc00::/7
		|| normalized.startsWith('fd')      // ULA fc00::/7
		|| normalized.startsWith('fe80')    // link-local fe80::/10
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
