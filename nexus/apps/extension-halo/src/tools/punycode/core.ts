// goal: decode each IDNA domain label with canonical browser validation
// RFC 3492 defines Punycode; URL handles the browser's IDNA mapping, not trust.
function asciiDomain(input: string): string {
	if (!input || /[\s/:@?#\\]/u.test(input)) throw new Error('Enter a domain, not a URL');
	const domain = new URL(`https://${input}`).hostname;
	if (domain.length > 254) throw new Error('Domain is too long');
	const labels = domain.replace(/\.$/u, '').split('.');
	if (labels.some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label))) throw new Error('Invalid domain label');
	return domain;
}

export function encode(input: string): string {
	try { return asciiDomain(input); } catch { return 'Invalid domain'; }
}

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
	delta = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
	delta += Math.floor(delta / numPoints);
	for (; delta > ((BASE - TMIN) * TMAX) / 2; k += BASE) {
		delta = Math.floor(delta / (BASE - TMIN));
	}
	return Math.floor(k + ((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

export function decode(input: string): string {
	try {
		const domain = asciiDomain(input);
		return domain.split('.').map((label) => {
			if (!/^xn--/iu.test(label)) return label;
			const decoded = decodeLabel(label.slice(4));
			if (asciiDomain(decoded).toLowerCase() !== label.toLowerCase()) throw new Error('Noncanonical Punycode');
			return decoded;
		}).join('.');
	} catch { return 'Invalid domain'; }
}

function decodeLabel(asciiPart: string): string {
	const output: number[] = [];

	// Find last delimiter
	const lastDelim = asciiPart.lastIndexOf(DELIMITER);
	let idx = 0;

	if (lastDelim >= 0) {
		for (let j = 0; j < lastDelim; j++) {
			const c = asciiPart.charCodeAt(j);
			if (c >= 0x80) throw new Error('Invalid Punycode');
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
			if (idx >= len) throw new Error('Truncated Punycode');

			const charCode = asciiPart.charCodeAt(idx++);
			const digit = charCode >= 48 && charCode <= 57 ? charCode - 22
				: charCode >= 65 && charCode <= 90 ? charCode - 65
					: charCode >= 97 && charCode <= 122 ? charCode - 97 : BASE;

			if (digit >= BASE) throw new Error('Invalid Punycode');

			if (digit > Math.floor((Number.MAX_SAFE_INTEGER - i) / w)) throw new Error('Punycode overflow');

			i += digit * w;
			const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;

			if (digit < t) break;

			if (w > Math.floor(Number.MAX_SAFE_INTEGER / (BASE - t))) throw new Error('Punycode overflow');
			w *= BASE - t;
		}

		const outLen = output.length + 1;
		bias = adapt(i - oldI, outLen, oldI === 0);

		if (Math.floor(i / outLen) > Number.MAX_SAFE_INTEGER - n) throw new Error('Punycode overflow');
		n += Math.floor(i / outLen);
		i %= outLen;

		if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw new Error('Invalid Unicode scalar');
		output.splice(i++, 0, n);
	}

	return String.fromCodePoint(...output);
}
