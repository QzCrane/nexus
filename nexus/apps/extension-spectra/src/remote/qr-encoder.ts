// goal: provide a dependency-free QR encoder for the authenticated pairing URL

// Byte-mode ECC-M data capacities for QR versions 1..10. Version 10 covers the
// longest production SPECTRA pairing URL while keeping the encoder small.
const DATA_CODEWORDS = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216] as const;
const RAW_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346] as const;
const ECC_CODEWORDS = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26] as const;
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] as const;
const ALIGNMENT: readonly (readonly number[])[] = [
	[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
	[6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

interface QrMatrix {
	size: number;
	modules: Int8Array;
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('QR invariant violated');
	return value;
}

function multiply(x: number, y: number): number {
	let z = 0;
	for (let i = 7; i >= 0; i -= 1) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z;
}

function reedSolomon(data: readonly number[], degree: number): number[] {
	const divisor = Array<number>(degree).fill(0);
	divisor[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i += 1) {
		for (let j = 0; j < degree; j += 1) {
			divisor[j] = multiply(required(divisor[j]), root)
				^ (j + 1 < degree ? required(divisor[j + 1]) : 0);
		}
		root = multiply(root, 2);
	}
	const result = Array<number>(degree).fill(0);
	for (const byte of data) {
		const factor = byte ^ (result.shift() ?? 0);
		result.push(0);
		for (let i = 0; i < degree; i += 1) {
			result[i] = required(result[i]) ^ multiply(required(divisor[i]), factor);
		}
	}
	return result;
}

function versionFor(bytes: number): number {
	for (let version = 1; version <= DATA_CODEWORDS.length; version += 1) {
		const countBits = version < 10 ? 8 : 16;
		if (4 + countBits + bytes * 8 <= required(DATA_CODEWORDS[version - 1]) * 8) return version;
	}
	throw new RangeError('Remote pairing URL exceeds QR capacity');
}

function maskBit(mask: number, x: number, y: number): boolean {
	const sum = x + y;
	const product = x * y;
	switch (mask) {
		case 0: return sum % 2 === 0;
		case 1: return y % 2 === 0;
		case 2: return x % 3 === 0;
		case 3: return sum % 3 === 0;
		case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
		case 5: return product % 2 + product % 3 === 0;
		case 6: return (product % 2 + product % 3) % 2 === 0;
		default: return (sum % 2 + product % 3) % 2 === 0;
	}
}

function penalty(modules: Int8Array, size: number): number {
	let score = 0;
	const at = (x: number, y: number): number => (modules[y * size + x] ?? 0) & 1;
	const scoreLine = (line: string): void => {
		for (const run of line.match(/(.)\1{4,}/g) ?? []) score += run.length - 2;
		const padded = `0000${line}0000`;
		for (const pattern of ['00001011101', '10111010000']) {
			for (let index = padded.indexOf(pattern); index >= 0; index = padded.indexOf(pattern, index + 1)) score += 40;
		}
	};
	for (let axis = 0; axis < 2; axis += 1) {
		for (let line = 0; line < size; line += 1) {
			let values = '';
			for (let pos = 0; pos < size; pos += 1) values += (axis === 0 ? at(pos, line) : at(line, pos)) ? '1' : '0';
			scoreLine(values);
		}
	}
	for (let y = 0; y + 1 < size; y += 1) {
		for (let x = 0; x + 1 < size; x += 1) {
			const value = at(x, y);
			if (value === at(x + 1, y) && value === at(x, y + 1) && value === at(x + 1, y + 1)) score += 3;
		}
	}
	let dark = 0;
	for (const value of modules) dark += value & 1;
	const total = size * size;
	score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
	return score;
}

function encodeMatrix(text: string): QrMatrix {
	const bytes = Array.from(new TextEncoder().encode(text));
	const version = versionFor(bytes.length);
	const dataCodewords = required(DATA_CODEWORDS[version - 1]);
	const dataCapacity = dataCodewords * 8;
	const data = Array<number>(dataCodewords).fill(0);
	let dataBitIndex = 0;
	const append = (value: number, length: number): void => {
		for (let i = length - 1; i >= 0; i -= 1) {
			const byteIndex = dataBitIndex >>> 3;
			data[byteIndex] = required(data[byteIndex]) | ((value >>> i) & 1) << (7 - (dataBitIndex & 7));
			dataBitIndex += 1;
		}
	};
	append(0b0100, 4);
	append(bytes.length, version < 10 ? 8 : 16);
	for (const byte of bytes) append(byte, 8);
	append(0, Math.min(4, dataCapacity - dataBitIndex));
	while (dataBitIndex % 8 !== 0) dataBitIndex += 1;
	for (let pad = 0xec; dataBitIndex < dataCapacity; pad ^= 0xec ^ 0x11) append(pad, 8);

	const blockCount = required(BLOCKS[version - 1]);
	const eccLength = required(ECC_CODEWORDS[version - 1]);
	const rawCodewords = required(RAW_CODEWORDS[version - 1]);
	const shortBlockLength = Math.floor(rawCodewords / blockCount);
	const shortBlockCount = blockCount - rawCodewords % blockCount;
	const blocks: number[][] = [];
	let offset = 0;
	for (let block = 0; block < blockCount; block += 1) {
		const length = shortBlockLength - eccLength + (block < shortBlockCount ? 0 : 1);
		const blockData = data.slice(offset, offset + length);
		offset += length;
		const ecc = reedSolomon(blockData, eccLength);
		if (block < shortBlockCount) blockData.push(0);
		blocks.push(blockData.concat(ecc));
	}
	const codewords: number[] = [];
	for (let index = 0; index < shortBlockLength + 1; index += 1) {
		for (let block = 0; block < blockCount; block += 1) {
			if (index !== shortBlockLength - eccLength || block >= shortBlockCount) {
				codewords.push(required(blocks[block]?.[index]));
			}
		}
	}

	const size = version * 4 + 17;
	const modules = new Int8Array(size * size);
	modules.fill(-1);
	const set = (x: number, y: number, dark: boolean): void => {
		if (x < 0 || y < 0 || x >= size || y >= size) return;
		const index = y * size + x;
		modules[index] = dark ? 3 : 2;
	};
	const drawFinder = (cx: number, cy: number): void => {
		for (let dy = -4; dy <= 4; dy += 1) {
			for (let dx = -4; dx <= 4; dx += 1) {
				const distance = Math.max(Math.abs(dx), Math.abs(dy));
				set(cx + dx, cy + dy, distance !== 2 && distance !== 4);
			}
		}
	};
	for (let i = 0; i < size; i += 1) {
		set(6, i, i % 2 === 0);
		set(i, 6, i % 2 === 0);
	}
	drawFinder(3, 3);
	drawFinder(size - 4, 3);
	drawFinder(3, size - 4);
	const alignment = ALIGNMENT[version - 1] ?? [];
	for (let y = 0; y < alignment.length; y += 1) {
		for (let x = 0; x < alignment.length; x += 1) {
			const last = alignment.length - 1;
			if ((y === 0 && x === 0) || (y === 0 && x === last) || (y === last && x === 0)) continue;
			const cx = required(alignment[x]);
			const cy = required(alignment[y]);
			for (let dy = -2; dy <= 2; dy += 1) {
				for (let dx = -2; dx <= 2; dx += 1) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
			}
		}
	}
	const drawFormat = (mask: number): void => {
		// The format information's two ECL bits are 00 for medium ECC.
		const value = mask;
		let remainder = value;
		for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
		const format = ((value << 10) | remainder) ^ 0x5412;
		for (let i = 0; i <= 5; i += 1) set(8, i, ((format >>> i) & 1) !== 0);
		set(8, 7, ((format >>> 6) & 1) !== 0);
		set(8, 8, ((format >>> 7) & 1) !== 0);
		set(7, 8, ((format >>> 8) & 1) !== 0);
		for (let i = 9; i < 15; i += 1) set(14 - i, 8, ((format >>> i) & 1) !== 0);
		for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, ((format >>> i) & 1) !== 0);
		for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, ((format >>> i) & 1) !== 0);
		set(8, size - 8, true);
	};
	drawFormat(0);
	if (version >= 7) {
		let remainder = version;
		for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
		const information = (version << 12) | remainder;
		for (let i = 0; i < 18; i += 1) {
			const dark = ((information >>> i) & 1) !== 0;
			const x = size - 11 + (i % 3);
			const y = Math.floor(i / 3);
			set(x, y, dark);
			set(y, x, dark);
		}
	}
	let bitIndex = 0;
	for (let right = size - 1; right >= 1; right -= 2) {
		if (right === 6) right = 5;
		for (let vertical = 0; vertical < size; vertical += 1) {
			for (let j = 0; j < 2; j += 1) {
				const x = right - j;
				const y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical;
				const index = y * size + x;
				if (required(modules[index]) < 0 && bitIndex < codewords.length * 8) {
					const bit = bitIndex++;
					const codeword = required(codewords[bit >>> 3]);
					modules[index] = (codeword >>> (7 - (bit & 7))) & 1;
				}
			}
		}
	}
	for (let index = 0; index < modules.length; index += 1) {
		if (required(modules[index]) < 0) modules[index] = 0;
	}
	let bestMask = 0;
	let bestScore = Number.POSITIVE_INFINITY;
	const applyMask = (mask: number): void => {
		for (let y = 0; y < size; y += 1) {
			for (let x = 0; x < size; x += 1) {
				const index = y * size + x;
				if (required(modules[index]) < 2 && maskBit(mask, x, y)) {
					modules[index] = required(modules[index]) ^ 1;
				}
			}
		}
	};
	for (let mask = 0; mask < 8; mask += 1) {
		applyMask(mask);
		drawFormat(mask);
		const currentScore = penalty(modules, size);
		if (currentScore < bestScore) {
			bestScore = currentScore;
			bestMask = mask;
		}
		applyMask(mask);
	}
	applyMask(bestMask);
	drawFormat(bestMask);
	return { size, modules };
}

export function renderQrSvg(text: string): string {
	const qr = encodeMatrix(text);
	const border = 2;
	const size = qr.size + border * 2;
	let path = '';
	for (let y = 0; y < qr.size; y += 1) {
		for (let x = 0; x < qr.size; x += 1) {
			if ((required(qr.modules[y * qr.size + x]) & 1) !== 0) {
				path += `M${x + border},${y + border}h1v1h-1z`;
			}
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect fill="#ffffff" width="${size}" height="${size}"/><path fill="#1a1a2e" d="${path}"/></svg>`;
}
