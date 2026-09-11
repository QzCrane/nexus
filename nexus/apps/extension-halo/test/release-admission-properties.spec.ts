import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseReleaseAdmission } from '../../../scripts/registry-gen/release-admission';

const baseline = JSON.parse(readFileSync(
	new URL('../release-admission.json', import.meta.url),
	'utf8',
));

function cloneBaseline(): typeof baseline {
	return structuredClone(baseline);
}

function seededStrings(seed: number, count: number): string[] {
	let state = seed >>> 0;
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789_./-*:';
	return Array.from({ length: count }, () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		const length = 1 + (state >>> 0) % 24;
		let value = '';
		for (let index = 0; index < length; index += 1) {
			state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
			value += alphabet[state % alphabet.length];
		}
		return value;
	});
}

describe('HALO release admission parser properties', () => {
	test('is deterministic and idempotent over the canonical admission document', () => {
		const first = parseReleaseAdmission(baseline);
		const second = parseReleaseAdmission(structuredClone(first));
		expect(second).toEqual(first);
	});

	test('rejects every generated traversal or wildcard web-runtime output', () => {
		const candidates = [
			'../runtime.js',
			'/runtime.js',
			'tools/*/runtime.js',
			'tools/../../runtime.js',
			...seededStrings(0x5ec0a11, 64).map((value) => `../${value}.js`),
		];
		for (const output of candidates) {
			const document = cloneBaseline();
			const ruler = document.modules.find((module: { id: string }) => module.id === 'ruler');
			ruler.webAccessibleRuntimes[0].output = output;
			expect(() => parseReleaseAdmission(document), output).toThrow();
		}
	});

	test('rejects arbitrary unknown stages and duplicated executable surfaces', () => {
		for (const stage of seededStrings(0xc105ed, 96).filter((value) => !['ready', 'beta', 'support'].includes(value))) {
			const document = cloneBaseline();
			document.modules[0].stage = stage;
			expect(() => parseReleaseAdmission(document), stage).toThrow();
		}
		for (const surface of ['panel', 'script-runtime', 'content-runtime', 'background-runtime']) {
			const document = cloneBaseline();
			document.modules[0].surfaces = [surface, surface];
			expect(() => parseReleaseAdmission(document), surface).toThrow('duplicates a surface');
		}
	});

	test('rejects duplicate storage identities and malformed active-service keys', () => {
		const duplicate = cloneBaseline();
		const hover = duplicate.modules.find((module: { id: string }) => module.id === 'hover-zoom');
		const smooth = duplicate.modules.find((module: { id: string }) => module.id === 'smooth-scroll');
		smooth.activeService.area = hover.activeService.area;
		smooth.activeService.key = hover.activeService.key;
		expect(() => parseReleaseAdmission(duplicate)).not.toThrow();
		// Cross-module storage identity uniqueness is a module-validation property,
		// not syntax parsing; syntax parsing still rejects unsafe keys locally.
		for (const key of ['../state', 'state key', '', '/root', ...seededStrings(0x51a7e, 48).map((value) => `../${value}`)]) {
			const document = cloneBaseline();
			const owner = document.modules.find((module: { id: string }) => module.id === 'hover-zoom');
			owner.activeService.key = key;
			expect(() => parseReleaseAdmission(document), key).toThrow();
		}
	});

	test('never accepts an unsorted or duplicate module owner list', () => {
		const duplicate = cloneBaseline();
		duplicate.modules.splice(1, 0, structuredClone(duplicate.modules[0]));
		expect(() => parseReleaseAdmission(duplicate)).toThrow(/duplicates|sorted/u);

		const reversed = cloneBaseline();
		reversed.modules.reverse();
		expect(() => parseReleaseAdmission(reversed)).toThrow('must be sorted by id');
	});
});
