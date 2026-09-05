import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { renderQrSvg } from '../src/remote/qr-encoder';

interface ParsedQr {
	size: number;
	modules: boolean[][];
}

function parseSvg(svg: string): ParsedQr {
	const viewBox = svg.match(/viewBox="0 0 ([0-9]+) ([0-9]+)"/);
	expect(viewBox).not.toBeNull();
	const size = Number(viewBox?.[1]);
	expect(size).toBe(Number(viewBox?.[2]));
	const path = svg.match(/<path fill="#1a1a2e" d="([^"]*)"\/>/);
	expect(path).not.toBeNull();
	const commands = [...(path?.[1] ?? '').matchAll(/M([0-9]+),([0-9]+)h1v1h-1z/g)];
	expect(commands.map(([command]) => command).join('')).toBe(path?.[1] ?? '');
	const modules = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
	for (const [, xText, yText] of commands) {
		const x = Number(xText);
		const y = Number(yText);
		expect(x).toBeGreaterThanOrEqual(2);
		expect(y).toBeGreaterThanOrEqual(2);
		expect(x).toBeLessThan(size - 2);
		expect(y).toBeLessThan(size - 2);
		expect(modules[y]?.[x]).toBe(false);
		if (modules[y]) modules[y][x] = true;
	}
	return { size, modules };
}

function matrixHash(parsed: ParsedQr): string {
	const bits = parsed.modules.map((row) => row.map((module) => (module ? '1' : '0')).join('')).join('');
	return createHash('sha256').update(bits).digest('hex');
}

describe('local QR encoder', () => {
	test('matches the uqr 0.1.3 Byte-mode ECC-M golden matrix', () => {
		// These hashes were generated once with uqr 0.1.3 using
		// encode(Array.from(new TextEncoder().encode(value)), {
		//   ecc: 'M', boostEcc: false, border: 2, maskPattern: -1,
		// }). The implementation intentionally has no runtime uqr dependency.
		const cases = [
			{
				value: 'A',
				size: 25,
				hash: '2a8ae35c11179f1eb38a4b0e07dd0918c54d7d51186ce1b98a4860fb3a7132fd',
			},
			{
				value: 'A'.repeat(14),
				size: 25,
				hash: '53f884a5eb42b207dbab852ba881975ea3fac0e55f0718b9c9978a52cc3ee93e',
			},
			{
				value: 'A'.repeat(15),
				size: 29,
				hash: '6965404aa0ca1ffe5f953f73e9091aa9721f36a7537a8055f22da192a83cd5f9',
			},
			{
				value: 'A'.repeat(106),
				size: 45,
				hash: 'd093210b2972204e8cc2913a57d00ca68507e621ea071bbf58905a945bfbe2ac',
			},
			{
				value: 'A'.repeat(107),
				size: 49,
				hash: '25e8e9bfa3ca1a6a4bf515d1296cacede2614cb5084d2b67c16bcde62b4ba1e7',
			},
			{
				value: 'A'.repeat(152),
				size: 53,
				hash: 'fdb0ecae23ebc7c96313c0ae43f7a873a3b0ca9a48f67cf6849438309cf29b3c',
			},
			{
				value: 'A'.repeat(153),
				size: 57,
				hash: 'b35aa4e41e16ca1d4c7a68a008c3ff58d27f95f05d6d1fc49794bf9997ddb2fa',
			},
			{
				value: 'A'.repeat(213),
				size: 61,
				hash: 'cc988ece533f62ba11dceea16a9c0a3e8faec86734eefd9dd4ddbff0346cf8ba',
			},
			{
				value: 'https://remote.example.test/#v=1&s=0123456789abcdef&p=abcdef0123456789&k=0123456789abcdef0123456789abcdef&e=1770000000000',
				size: 49,
				hash: 'b03e17feaf16c67ac1c3a7af48f47d24e95738cd2cf2b69e0d05366256c74d73',
			},
			{
				value: 'https://remote.example.test/#v=1&s=秘密&p=配对&k=密钥&e=1770000000000',
				size: 41,
				hash: 'fe3ceb3024174b63ed3e42675d40c4d3952c40217f3b77da836f820ca413c9c9',
			},
		] as const;

		for (const qrCase of cases) {
			const parsed = parseSvg(renderQrSvg(qrCase.value));
			expect(parsed.size).toBe(qrCase.size);
			expect(matrixHash(parsed)).toBe(qrCase.hash);
		}
	});

	test('rejects payloads beyond the supported version-10 ECC-M byte capacity', () => {
		expect(() => renderQrSvg('A'.repeat(213))).not.toThrow();
		expect(() => renderQrSvg('A'.repeat(214))).toThrow('Remote pairing URL exceeds QR capacity');
	});

	test('emits sanitizer-compatible SVG with a two-module quiet zone', () => {
		const svg = renderQrSvg('https://remote.example.test/#中文');
		expect(svg).toMatch(
			/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 ([0-9]+) \1"><rect fill="#ffffff" width="\1" height="\1"\/><path fill="#1a1a2e" d="M[0-9]+,[0-9]+h1v1h-1z/,
		);
		const parsed = parseSvg(svg);
		expect(parsed.size).toBeGreaterThan(21);
		expect(svg.endsWith('</svg>')).toBe(true);
	});
});
