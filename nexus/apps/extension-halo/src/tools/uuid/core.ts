// goal: UUID generation core logic (v1, v4, v7, ULID)

let lastV1Time = 0;
let v1Sequence = Math.floor(Math.random() * 0x3fff);
const v1Node = crypto.getRandomValues(new Uint8Array(6));

/**
 * Generate v1 UUID (Time-based)
 */
export function generateV1(): string {
	let now = Date.now();
	// UUID v1 uses 100-nanosecond intervals since 1582-10-15
	const windowsEpoch = 12219292800000;
	const intervals = BigInt(now + windowsEpoch) * 10000n;

	if (now <= lastV1Time) {
		v1Sequence = (v1Sequence + 1) & 0x3fff;
	}
	lastV1Time = now;

	const timeLow = Number(intervals & 0xffffffffn);
	const timeMid = Number((intervals >> 32n) & 0xffffn);
	const timeHiAndVersion = Number((intervals >> 48n) & 0x0fffn) | 0x1000;

	const toHex = (n: number, len: number) => n.toString(16).padStart(len, '0');

	return [
		toHex(timeLow, 8),
		toHex(timeMid, 4),
		toHex(timeHiAndVersion, 4),
		toHex((v1Sequence >> 8) | 0x80, 2) + hideHex(v1Sequence & 0xff, 2),
		Array.from(v1Node).map(b => b.toString(16).padStart(2, '0')).join('')
	].join('-');
}

function hideHex(n: number, len: number) { return n.toString(16).padStart(len, '0'); }

/**
 * Generate v4 UUID using native API
 */
export function generateV4(): string {
	return crypto.randomUUID();
}

/**
 * Generate ULID (Canonical implementation in pure JS)
 */
export function generateULID(): string {
	const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
	const time = Date.now();
	const timeLen = 10;
	const randomLen = 16;
	let str = '';
	let t = time;
	for (let i = timeLen - 1; i >= 0; i--) {
		str = ENCODING.charAt(t % 32) + str;
		t = Math.floor(t / 32);
	}
	str = str.padStart(timeLen, '0');
	const randomValues = new Uint8Array(randomLen);
	crypto.getRandomValues(randomValues);
	for (let i = 0; i < randomLen; i++) str += ENCODING.charAt(randomValues[i] % 32);
	return str;
}

/**
 * Generate v7 UUID (Proposed standard - Timestamp based)
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
	value[6] = (value[6] & 0x0f) | 0x70;
	value[8] = (value[8] & 0x3f) | 0x80;
	return [...value].map((b, i) => {
		const hex = b.toString(16).padStart(2, '0');
		return (i === 4 || i === 6 || i === 8 || i === 10) ? '-' + hex : hex;
	}).join('');
}

export function formatUUID(uuid: string, uppercase: boolean, hyphens: boolean): string {
	let result = uuid;
	if (!hyphens) result = result.replace(/-/g, '');
	if (uppercase) result = result.toUpperCase();
	return result;
}
