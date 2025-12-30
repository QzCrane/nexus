// goal: UUID generation core logic

/**
 * Generate v4 UUID using native API
 */
export function generateV4(): string {
	return crypto.randomUUID();
}

/**
 * Generate ULID (Canonical implementation in pure JS)
 * 26 chars: 10 chars timestamp (base32), 16 chars randomness (base32)
 */
export function generateULID(): string {
	const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
	const time = Date.now();
	const timeLen = 10;
	const randomLen = 16;

	let str = '';

	// Encode time
	let t = time;
	for (let i = timeLen - 1; i >= 0; i--) {
		const mod = t % 32;
		str = ENCODING.charAt(mod) + str;
		t = Math.floor(t / 32);
	}
	// Pad if needed (unlikely for current dates)
	str = str.padStart(timeLen, '0');

	// Encode randomness
	let rand = '';
	const randomValues = new Uint8Array(randomLen);
	crypto.getRandomValues(randomValues);

	for (let i = 0; i < randomLen; i++) {
		rand += ENCODING.charAt(randomValues[i] % 32);
	}

	return str + rand;
}

/**
 * Generate v7 UUID (Proposed standard - Timestamp based)
 * Simple implementation for utility
 */
export function generateV7(): string {
	const value = new Uint8Array(16);
	crypto.getRandomValues(value);

	const timestamp = Date.now();

	value[0] = (timestamp >> 40) & 0xff;
	value[1] = (timestamp >> 32) & 0xff;
	value[2] = (timestamp >> 24) & 0xff;
	value[3] = (timestamp >> 16) & 0xff;
	value[4] = (timestamp >> 8) & 0xff;
	value[5] = timestamp & 0xff;

	value[6] = (value[6] & 0x0f) | 0x70; // version 7
	value[8] = (value[8] & 0x3f) | 0x80; // variant 1

	return [...value].map((b, i) => {
		const hex = b.toString(16).padStart(2, '0');
		if (i === 4 || i === 6 || i === 8 || i === 10) return '-' + hex;
		return hex;
	}).join('');
}

export function formatUUID(uuid: string, uppercase: boolean, hyphens: boolean): string {
	let result = uuid;
	if (!hyphens) result = result.replace(/-/g, '');
	if (uppercase) result = result.toUpperCase();
	return result;
}
