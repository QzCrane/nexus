// goal: UUID generation core logic (v1, v4, v7, ULID)

let lastV1Time = 0;
let v1Sequence = new DataView(crypto.getRandomValues(new Uint8Array(2)).buffer).getUint16(0) & 0x3fff;
const v1Node = crypto.getRandomValues(new Uint8Array(6));
v1Node[0] = (v1Node[0] ?? 0) | 1; // RFC 9562: a random node is not an IEEE MAC address.

/**
 * Generate v1 UUID (Time-based)
 */
export function generateV1(): string {
	const now = Date.now();
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
export function generateULID(nowMs = Date.now()): string {
	const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
	const time = timestamp48(nowMs);
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
	for (const value of randomValues) str += ENCODING.charAt(value % 32);
	return str;
}

/**
 * Generate RFC 9562 UUIDv7 (48-bit Unix milliseconds, random within one millisecond)
 */
export function generateV7(nowMs = Date.now()): string {
	const value = new Uint8Array(16);
	crypto.getRandomValues(value);
	let timestamp = BigInt(timestamp48(nowMs));
	for (let index = 5; index >= 0; index -= 1) {
		value[index] = Number(timestamp & 0xffn);
		timestamp >>= 8n;
	}
	value[6] = ((value[6] ?? 0) & 0x0f) | 0x70;
	value[8] = ((value[8] ?? 0) & 0x3f) | 0x80;
	return [...value].map((b, i) => {
		const hex = b.toString(16).padStart(2, '0');
		return (i === 4 || i === 6 || i === 8 || i === 10) ? `-${hex}` : hex;
	}).join('');
}

export function formatUUID(uuid: string, uppercase: boolean, hyphens: boolean): string {
	let result = uuid;
	if (!hyphens) result = result.replace(/-/g, '');
	if (uppercase) result = result.toUpperCase();
	return result;
}

function timestamp48(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** 48) {
		throw new RangeError('Timestamp must be an unsigned 48-bit integer in milliseconds');
	}
	return value;
}
