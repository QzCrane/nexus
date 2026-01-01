// goal: Punycode core logic (using URL API for reliability)

// Encode Unicode to Punycode
export function encode(input: string): string {
	try {
		// Use browser's URL parser to handle IDN
		const url = new URL(`https://${input}`);
		return url.hostname;
	} catch {
		return 'Invalid domain';
	}
}

// Decode Punycode to Unicode (basic implementation since URL API doesn't expose decode directly usually)
// For fully compliant implementation, we would need the full RFC3492 code.
// However, since we want Zero Dependencies and lightweight, we can try a trick or include a minimal implementation.
// Let's implement a minimal RFC3492 decoder as it's standard and stable.

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = '-';

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
	let k = 0;
	delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
	delta += Math.floor(delta / numPoints);
	for (; delta > ((BASE - TMIN) * TMAX) / 2; k += BASE) {
		delta = Math.floor(delta / (BASE - TMIN));
	}
	return Math.floor(k + ((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

export function decode(input: string): string {
	if (!input.startsWith('xn--')) {
		// Not a punycode string, return as is or error? Let's just return key parts if it looks like a domain
		// If it's a full domain, split dots
		if (input.includes('.')) {
			return input.split('.').map(part => decode(part)).join('.');
		}
		return input;
	}

	const output: number[] = [];
	const asciiPart = input.replace('xn--', '');

	// Find last delimiter
	const lastDelim = asciiPart.lastIndexOf(DELIMITER);
	let idx = 0;

	if (lastDelim > 0) {
		for (let j = 0; j < lastDelim; j++) {
			const c = asciiPart.charCodeAt(j);
			if (c >= 0x80) return 'Invalid input';
			output.push(c);
		}
		idx = lastDelim + 1;
	}

	let n = INITIAL_N;
	let i = 0;
	let bias = INITIAL_BIAS;

	const len = asciiPart.length;

	while (idx < len) {
		const oldI = i;
		let w = 1;

		for (let k = BASE; ; k += BASE) {
			if (idx >= len) return 'Invalid input';

			const charCode = asciiPart.charCodeAt(idx++);
			const digit = charCode - 48 < 10 ? charCode - 22 : charCode - 65 < 26 ? charCode - 65 : charCode - 97 < 26 ? charCode - 97 : BASE;

			if (digit >= BASE) return 'Invalid input';

			if (digit > Math.floor((Number.MAX_SAFE_INTEGER - i) / w)) return 'Overflow';

			i += digit * w;
			const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;

			if (digit < t) break;

			if (w > Math.floor(Number.MAX_SAFE_INTEGER / (BASE - t))) return 'Overflow';
			w *= BASE - t;
		}

		const outLen = output.length + 1;
		bias = adapt(i - oldI, outLen, oldI === 0);

		if (Math.floor(i / outLen) > Number.MAX_SAFE_INTEGER - n) return 'Overflow';
		n += Math.floor(i / outLen);
		i %= outLen;

		output.splice(i++, 0, n);
	}

	return String.fromCodePoint(...output);
}
