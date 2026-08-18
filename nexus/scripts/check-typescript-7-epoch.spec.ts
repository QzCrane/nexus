import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	checkTypeScript7Epoch,
	deprecatedCompilerOptions,
} from './check-typescript-7-epoch';

const current = JSON.parse(
	readFileSync(new URL('../typescript-7-epoch.json', import.meta.url), 'utf8'),
);

describe('TypeScript 7 compiler epoch governance', () => {
	test('accepts the current compatibility-prep state', () => {
		expect(() => checkTypeScript7Epoch()).not.toThrow();
	});

	test('recognizes the TypeScript 6 options that TypeScript 7 cannot retain', () => {
		expect(deprecatedCompilerOptions({
		baseUrl: '.',
		downlevelIteration: false,
		moduleResolution: 'node',
		target: 'ES5',
		module: 'AMD',
		outFile: 'bundle.js',
		esModuleInterop: false,
		allowSyntheticDefaultImports: false,
		alwaysStrict: false,
		ignoreDeprecations: '6.0',
	})).toEqual([
		'allowSyntheticDefaultImports=false',
		'alwaysStrict=false',
		'baseUrl',
		'downlevelIteration',
		'esModuleInterop=false',
		'ignoreDeprecations',
		'module=amd',
		'moduleResolution=node',
		'outFile',
		'target=es5',
	]);
	});

	test('rejects a stale or invented programmatic API consumer marker', () => {
		const epoch = structuredClone(current);
		epoch.programmaticApiConsumers[0].marker = 'ts.__invented_native_api__';
		expect(() => checkTypeScript7Epoch({ epoch })).toThrow('consumer marker/import drifted');
	});

	test('cannot advance to the dual CLI phase before aliases and lock transition exist', () => {
		const epoch = structuredClone(current);
		epoch.phase = 'dual-cli';
		expect(() => checkTypeScript7Epoch({ epoch })).toThrow('TypeScript 6 compatibility alias is missing');
	});
});
