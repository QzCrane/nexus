import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import ts from 'typescript-compiler-api';
import { auditHaloStorageBoundaries, loadHaloStorageBoundaryProgram } from './check-halo-storage-boundaries';

const workspaceRoot = resolve(import.meta.dir, '..');
const audit = auditHaloStorageBoundaries(
	loadHaloStorageBoundaryProgram(workspaceRoot),
	resolve(workspaceRoot, 'apps/extension-halo/src'),
);

function normalizedPath(path: string): string {
	return path.replaceAll('\\', '/').toLowerCase();
}

function auditFixture(): ReturnType<typeof auditHaloStorageBoundaries> {
	const fixtureRoot = resolve(workspaceRoot, '.compiler-fixtures/halo-storage/src');
	const hookPath = resolve(fixtureRoot, 'kernel/hooks/use-tool-state.ts');
	const callsPath = resolve(fixtureRoot, 'calls.ts');
	const files = new Map([
		[normalizedPath(hookPath), `
export type DecodeResult<T> = { kind: 'valid'; value: T } | { kind: 'invalid'; fallback: T };
export interface ToolStateCodec<T> {
	decode(value: unknown): DecodeResult<T>;
	encode(value: T): unknown;
}
export interface ToolStateOptions<T> {
	codec?: ToolStateCodec<T>;
	normalize?: (value: unknown, fallback: T) => T;
}
export declare function useToolState<T>(key: string, initialValue: T, options?: ToolStateOptions<T>): T;
`],
		[normalizedPath(callsPath), `
import { useToolState as importedAlias, type ToolStateCodec } from './kernel/hooks/use-tool-state';
import * as hooks from './kernel/hooks/use-tool-state';

const numberCodec = {} as ToolStateCodec<number>;
const objectCodec = {} as ToolStateCodec<{ count: number }>;
const stringCodec = {} as ToolStateCodec<string>;
const codec = numberCodec;
const options = { codec: numberCodec };
const { useToolState: destructuredAlias } = hooks;

importedAlias<string>('simple', 'raw');
hooks.useToolState('namespace', { count: 1 }, { codec: objectCodec });
(importedAlias)('parenthesized', 1, { codec });
destructuredAlias('destructured', 1, options);
importedAlias<number>('wrong', 1, { codec: stringCodec });
const anyCodec: any = numberCodec;
importedAlias<number>('any', 1, { codec: anyCodec });
const unknownCodec: unknown = numberCodec;
importedAlias<number>('unknown', 1, { codec: unknownCodec });
const optionalOptions: { codec?: ToolStateCodec<{ count: number }> } = {};
importedAlias('optional', { count: 1 }, optionalOptions);
importedAlias('missing', { count: 1 });
importedAlias('normalized', 1, { normalize: (value, fallback) => typeof value === 'number' ? value : fallback });

function useToolState<T>(value: T): T { return value; }
useToolState({ unrelated: true });
`],
	]);
	const options: ts.CompilerOptions = {
		strict: true,
		target: ts.ScriptTarget.ESNext,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		noEmit: true,
		skipLibCheck: true,
	};
	const host = ts.createCompilerHost(options);
	const defaultGetSourceFile = host.getSourceFile.bind(host);
	const normalizedFixtureRoot = normalizedPath(fixtureRoot);
	host.fileExists = (fileName) => files.has(normalizedPath(fileName)) || ts.sys.fileExists(fileName);
	host.directoryExists = (directoryName) => {
		const directory = normalizedPath(directoryName);
		return normalizedFixtureRoot.startsWith(directory) || directory.startsWith(normalizedFixtureRoot)
			|| ts.sys.directoryExists(directoryName);
	};
	host.readFile = (fileName) => files.get(normalizedPath(fileName)) ?? ts.sys.readFile(fileName);
	host.realpath = (path) => files.has(normalizedPath(path)) ? path : ts.sys.realpath(path);
	host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
		const source = files.get(normalizedPath(fileName));
		return source === undefined
			? defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
			: ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TS);
	};
	const program = ts.createProgram([hookPath, callsPath], options, host);
	return auditHaloStorageBoundaries(program, fixtureRoot);
}

describe('HALO storage boundary compiler gate', () => {
	test('classifies every admitted hook call into one disjoint bucket', () => {
		expect(audit.corpus).toBe('tsconfig-src');
		expect(audit.sourceFiles).toBeGreaterThan(0);
		expect(audit.total).toBeGreaterThan(0);
		expect(audit.total).toBe(audit.simple + audit.codec + audit.normalize + audit.diagnostics.filter((entry) => entry.reason === 'missing-domain-codec').length);
		expect(audit.diagnostics.every((entry) => entry.file.endsWith('.ts') || entry.file.endsWith('.tsx'))).toBe(true);
	});

	test('follows canonical signatures through aliases and rejects unsafe codec types', () => {
		const fixture = auditFixture();
		expect(fixture).toMatchObject({
			corpus: 'tsconfig-src',
			sourceFiles: 1,
			total: 10,
			simple: 1,
			codec: 6,
			normalize: 1,
		});
		expect(fixture.diagnostics.map(({ reason }) => reason)).toEqual([
			'incompatible-domain-codec',
			'incompatible-domain-codec',
			'incompatible-domain-codec',
			'missing-domain-codec',
			'missing-domain-codec',
		]);
		expect(fixture.diagnostics.every(({ file }) => file === 'calls.ts')).toBe(true);
	});

	test('uses TypeScript assignability for every installed codec', () => {
		expect(audit.diagnostics.filter((entry) => entry.reason === 'incompatible-domain-codec')).toEqual([]);
	});

	test('requires a domain codec for every structured, nullable, ranged, or closed-union state', () => {
		expect(audit.diagnostics).toEqual([]);
	});
});
