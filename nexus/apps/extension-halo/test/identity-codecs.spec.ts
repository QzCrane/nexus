import { describe, expect, test } from 'bun:test';
import { generateV7, generateULID } from '../src/tools/uuid/core';
import { generateULID as randomULID } from '../src/tools/random-gen/core';
import { base32ToBytes, generateTotp, parseOtpAuthUri, totpCounter } from '../src/tools/totp/core';
import { convertBase, formatWithGrouping, isValidForBase } from '../src/tools/number-base/core';
import { decodeProto, parseInput } from '../src/tools/protobuf/core';
import { encode, decode } from '../src/tools/punycode/core';
import { parseURL } from '../src/tools/url/core';
import { decodeJwt } from '../src/tools/jwt-decoder/core';
import { decodeJWT } from '../src/tools/crypto/core';

function base32(text: string): string {
	const bits = Array.from(new TextEncoder().encode(text), (byte) => byte.toString(2).padStart(8, '0')).join('');
	return (bits.match(/.{1,5}/gu) ?? []).map((piece) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[Number.parseInt(piece.padEnd(5, '0'), 2)]).join('');
}
function varint(value: bigint): number[] {
	const result: number[] = [];
	do { const byte = Number(value & 127n); value >>= 7n; result.push(byte | (value ? 128 : 0)); } while (value);
	return result;
}

describe('identity and integer precision', () => {
	test('UUIDv7 stores all 48 timestamp bits and the RFC version/variant', () => {
		for (const time of [0, 2 ** 32 - 1, 2 ** 32, 1_700_000_000_000, 2 ** 48 - 1]) {
			const uuid = generateV7(time);
			expect(Number.parseInt(uuid.replaceAll('-', '').slice(0, 12), 16)).toBe(time);
			expect(uuid[14]).toBe('7');
			expect('89ab').toContain(uuid.charAt(19));
		}
		for (const time of [-1, NaN, Infinity, 1.1, 2 ** 48]) expect(() => generateV7(time)).toThrow();
		expect(new Set(Array.from({ length: 1000 }, () => generateV7(10))).size).toBe(1000);
	});
	test('both ULID entries use the 26-character canonical encoding', () => {
		expect(generateULID(0)).toMatch(/^0{10}[0-9A-HJKMNP-TV-Z]{16}$/u);
		expect(randomULID()).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u);
	});
	test('base conversion preserves arbitrary integers and rejects partial parses', () => {
		for (const value of [9007199254740993n, (1n << 200n) + 71n, -12345678901234567890n]) {
			expect(convertBase(value.toString(), 10)?.decimal).toBe(value.toString());
			expect(convertBase(value.toString(16), 16)?.decimal).toBe(value.toString());
		}
		for (const input of ['12junk', '1.5', '0x10', '', '1e9']) expect(convertBase(input, 10)).toBeNull();
		expect(convertBase('-0x100000001', 16)?.decimal).toBe('-4294967297');
		expect(isValidForBase('102', 2)).toBe(false);
		expect(formatWithGrouping('-1234567', 3)).toBe('-1 234 567');
		expect(() => formatWithGrouping('123', 0)).toThrow();
	});
});

describe('RFC 6238 TOTP', () => {
	const cases = [
		[59, '94287082', '46119246', '90693936'],
		[1111111109, '07081804', '68084774', '25091201'],
		[1111111111, '14050471', '67062674', '99943326'],
		[1234567890, '89005924', '91819424', '93441116'],
		[2000000000, '69279037', '90698825', '38618901'],
		[20000000000, '65353130', '77737706', '47863826'],
	] as const;
	for (const [seconds, ...codes] of cases) test(`all three standard HMAC vectors at ${seconds}`, async () => {
		for (const [index, algorithm] of (['SHA1', 'SHA256', 'SHA512'] as const).entries()) {
			const length = [20, 32, 64][index];
			const key = '1234567890'.repeat(7).slice(0, length);
			expect((await generateTotp(base32(key), 8, 30, seconds * 1000, algorithm)).code).toBe(codes[index]);
		}
	});
	test('URI imports retain issuer, account, algorithm and numeric parameters', () => {
		expect(parseOtpAuthUri('otpauth://totp/Acme:alice%3Awork?secret=JBSWY3DPEHPK3PXP&issuer=Acme&algorithm=SHA256&digits=8&period=60'))
			.toMatchObject({ issuer: 'Acme', name: 'alice:work', algorithm: 'SHA256', digits: 8, period: 60 });
		const base = 'otpauth://totp/Acme:alice?secret=JBSWY3DPEHPK3PXP';
		for (const input of [base.replace('//totp', '//hotp'), ...['period=0', 'period=30junk', 'digits=5', 'issuer=Other', 'algorithm=MD5', 'secret=MY', 'counter=1'].map((query) => `${base}&${query}`)]) {
			expect(parseOtpAuthUri(input)).toBeNull();
		}
	});
	test('invalid Base32 is not silently repaired into another secret', () => {
		expect(Array.from(base32ToBytes('MY======'))).toEqual([102]);
		for (const key of ['M', 'MY=', 'MZ', 'MY!======', '1234', '']) expect(() => base32ToBytes(key)).toThrow();
		for (const period of [0, -1, Infinity, NaN, 0.5]) expect(() => totpCounter(0, period)).toThrow();
	});
});

describe('untyped wire decoding', () => {
	test('varints retain 32-bit, 53-bit and unsigned 64-bit boundaries', () => {
		for (const value of [150n, 4294967296n, 9007199254740993n, (1n << 64n) - 1n]) {
			const [field] = decodeProto(Uint8Array.from([8, ...varint(value)]));
			expect(String(field?.value)).toBe(value.toString());
		}
	});
	test('rejects corrupt tails rather than showing successful partial decoding', () => {
		for (const bytes of [[0], [8, 128], [8, ...Array(10).fill(255)], [10, 9, 1], [14], [12], [11, 20]]) {
			expect(() => decodeProto(Uint8Array.from(bytes))).toThrow();
		}
		expect(decodeProto(Uint8Array.from([11, 16, 1, 12]))[0]?.subMessage?.[0]?.value).toBe(1);
	});
	test('retains raw length-delimited bytes and labels interpretations', () => {
		const [field] = decodeProto(Uint8Array.from([10, 3, 102, 111, 111]));
		expect(field?.raw).toEqual(Uint8Array.from([102, 111, 111]));
		expect(field?.interpretation).toBe('utf8-candidate');
		expect(parseInput('a', 'hex')).toBeNull();
		expect(parseInput('AB==', 'base64')).toBeNull();
		expect(parseInput('CJYB', 'base64')).toEqual(Uint8Array.from([8, 150, 1]));
	});
});

describe('text identities', () => {
	test('decodes each Punycode label and rejects malformed domain input', () => {
		for (const domain of ['例子.测试', 'bücher.example', '中国.рф']) expect(decode(encode(domain))).toBe(domain);
		expect(decode('XN--BCHER-KVA.example')).toBe('bücher.example');
		for (const domain of ['example.org/path', 'a@b.example', 'foo..bar', 'xn--', 'xn--abc!']) expect(encode(domain)).toBe('Invalid domain');
	});
	test('URL view preserves duplicate parameter names and order', () => {
		expect(JSON.parse(parseURL('https://example.org/?a=1&a=2&__proto__=x&=empty').Params ?? '')).toEqual([
			{ name: 'a', value: '1' }, { name: 'a', value: '2' }, { name: '__proto__', value: 'x' }, { name: '', value: 'empty' },
		]);
	});
	test('both JWT viewers decode UTF-8 without asserting signature validity', () => {
		const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
		const token = `${b64({ alg: 'HS256' })}.${b64({ name: '中文😀', exp: 4_000_000_000 })}.c2ln`;
		expect(decodeJwt(token)?.payload.name).toBe('中文😀');
		expect(decodeJWT(token).payload.name).toBe('中文😀');
		expect(decodeJWT(token).isValid).toBeUndefined();
		expect(decodeJwt(`${b64({ alg: 'none' })}.${b64(null)}.`)).toBeNull();
	});
});

// Randomness tests assert rejection and alphabet semantics, not flaky frequency cutoffs.
import { spyOn } from 'bun:test';
import { DEFAULT_CONFIG, generatePassword, generatePasswords, passwordAlphabet, evaluateStrength } from '../src/tools/password-gen/core';
import { paletteFromPixels } from '../src/tools/color-palette/core';

test('passwords sample a unique scalar pool and reject the biased remainder', () => {
	const config = { ...DEFAULT_CONFIG, length: 2, uppercase: false, lowercase: false, numbers: false, symbols: true, customSymbols: 'aab😀' };
	expect(passwordAlphabet(config)).toEqual(['a', 'b', '😀']);
	let calls = 0;
	const random = spyOn(crypto, 'getRandomValues').mockImplementation((buffer) => {
		if (!(buffer instanceof Uint32Array)) throw new Error('Unexpected entropy buffer');
		buffer.set(calls++ === 0 ? [0xFFFFFFFF, 2] : [1, 0]);
		return buffer;
	});
	try { expect(generatePassword(config)).toBe('😀b'); expect(calls).toBe(2); } finally { random.mockRestore(); }
	for (const count of [0, NaN, 1001]) expect(() => generatePasswords(config, count)).toThrow();
	expect(evaluateStrength('CorrectHorseBatteryStaple123!').feedback.join(' ')).toContain('Heuristic only');
});

test('palette quantization remains in gamut and excludes invisible pixels', () => {
	const colors = paletteFromPixels(Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 0]));
	expect(colors).toEqual([{ hex: '#ffffff', rgb: 'rgb(255, 255, 255)', count: 1, percentage: 100 }]);
	expect(paletteFromPixels(Uint8ClampedArray.from([0, 0, 0, 0]))).toEqual([]);
	expect(() => paletteFromPixels(Uint8ClampedArray.from([1, 2, 3]))).toThrow();
});
