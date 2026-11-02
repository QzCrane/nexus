import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
	collectBiomeFiles,
	findEmptyCatchBlocks,
	findEmptyRejectionHandlers,
	validateTargets,
	validateZeroDiagnosticReport,
} from './run-strict-biome.ts';

function report(summary = {}, diagnostics = []) {
	return {
		command: 'check',
		summary: {
			changed: 0,
			unchanged: 1,
			errors: 0,
			warnings: 0,
			infos: 0,
			skipped: 0,
			diagnosticsNotPrinted: 0,
			...summary,
		},
		diagnostics,
	};
}

describe('strict Biome report contract', () => {
	test('passes only admitted files when a staged generated artifact is outside the workspace', () => {
		const result = spawnSync(process.execPath, [
			'scripts/run-strict-biome.ts',
			'scripts/run-strict-biome.ts',
			'../remote-site/dist/protocol.js',
		], { cwd: resolve(import.meta.dir, '..'), encoding: 'utf8' });
		expect(result.stderr).toBe('');
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Strict Biome: 1 files, 0 diagnostics, 0 silent handlers');
	});

	test('accepts file targets and rejects missing or injected CLI options', () => {
		expect(() => validateTargets(['scripts', 'package.json'])).not.toThrow();
		expect(() => validateTargets([])).toThrow('at least one target');
		expect(() => validateTargets(['src', '--linter-enabled=false'])).toThrow(
			'cannot inject Biome options',
		);
		expect(() => validateTargets(['scripts', './scripts'])).toThrow('duplicated');
		expect(() =>
			validateTargets(['scripts', 'scripts/run-strict-biome.ts']),
		).toThrow('overlap');
		expect(() => validateTargets(['does-not-exist'])).toThrow('does not exist');
		expect(() =>
			validateTargets([resolve(process.cwd(), '..', '..')]),
		).toThrow('escapes or equals');
	});

	test('rejects repository-local links that resolve outside the repository', () => {
		const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'strict-biome-target-'));
		const repositoryRoot = resolve(fixtureRoot, 'repository');
		const outside = resolve(fixtureRoot, 'outside');
		const inside = resolve(repositoryRoot, 'inside');
		const linkedTarget = resolve(repositoryRoot, 'linked-target');
		const linkedInside = resolve(repositoryRoot, 'linked-inside');
		mkdirSync(repositoryRoot);
		mkdirSync(outside);
		mkdirSync(inside);
		try {
			symlinkSync(
				outside,
				linkedTarget,
				process.platform === 'win32' ? 'junction' : 'dir',
			);
			expect(() =>
				validateTargets(['linked-target'], repositoryRoot, repositoryRoot),
			).toThrow('resolves outside');
			symlinkSync(
				inside,
				linkedInside,
				process.platform === 'win32' ? 'junction' : 'dir',
			);
			expect(() =>
				validateTargets(['linked-inside'], repositoryRoot, repositoryRoot),
			).toThrow('cannot be a symbolic link');
		} finally {
			rmSync(fixtureRoot, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100,
			});
		}
	});

	test('rejects nested links and targets that contribute no lint files', () => {
		const fixtureRoot = mkdtempSync(resolve(tmpdir(), 'strict-biome-coverage-'));
		const repositoryRoot = resolve(fixtureRoot, 'repository');
		const sourceRoot = resolve(repositoryRoot, 'src');
		const skippedRoot = resolve(repositoryRoot, '.turbo');
		const vendorRoot = resolve(repositoryRoot, 'vendor');
		const outside = resolve(fixtureRoot, 'outside');
		mkdirSync(sourceRoot, { recursive: true });
		mkdirSync(skippedRoot);
		mkdirSync(vendorRoot);
		mkdirSync(outside);
		writeFileSync(resolve(sourceRoot, 'valid.mts'), 'export const valid = true;\n');
		writeFileSync(resolve(sourceRoot, 'valid.cts'), 'exports.valid = true;\n');
		writeFileSync(resolve(sourceRoot, 'valid.mjs'), 'export const validMjs = true;\n');
		writeFileSync(resolve(sourceRoot, 'notes.md'), '# notes\n');
		writeFileSync(resolve(skippedRoot, 'omitted.ts'), 'export const omitted = true;\n');
		writeFileSync(
			resolve(vendorRoot, 'peerjs.min.js'),
			'export const vendored = true;\n',
		);
		try {
			expect(
				collectBiomeFiles(['src'], repositoryRoot, repositoryRoot),
			).toHaveLength(3);
			// biome.json owns the exclusion set. A path inside vendor/dist contributes
			// no expected files whether it arrives as a directory or an explicit file;
			// otherwise the expected count would disagree with Biome's real scan.
			expect(
				collectBiomeFiles(['.turbo'], repositoryRoot, repositoryRoot),
			).toEqual([]);
			expect(
				collectBiomeFiles(['vendor/peerjs.min.js'], repositoryRoot, repositoryRoot),
			).toEqual([]);
			expect(
				collectBiomeFiles(
					['src', 'vendor/peerjs.min.js'],
					repositoryRoot,
					repositoryRoot,
				),
			).toHaveLength(3);
			expect(() =>
				collectBiomeFiles(['src/notes.md'], repositoryRoot, repositoryRoot),
			).toThrow('contributes no supported lint files');

			symlinkSync(
				outside,
				resolve(sourceRoot, 'linked-outside'),
				process.platform === 'win32' ? 'junction' : 'dir',
			);
			expect(() =>
				collectBiomeFiles(['src'], repositoryRoot, repositoryRoot),
			).toThrow('unsupported symbolic link');
		} finally {
			rmSync(fixtureRoot, {
				recursive: true,
				force: true,
				maxRetries: 5,
				retryDelay: 100,
			});
		}
	});

	test('accepts only a complete zero-diagnostic report', () => {
		expect(() => validateZeroDiagnosticReport(report(), 1)).not.toThrow();
		expect(() => validateZeroDiagnosticReport(report(), 2)).toThrow(
			'processed 1 of 2 expected files',
		);
	});

	test('rejects every diagnostic severity', () => {
		for (const [field, severity] of [
			['errors', 'error'],
			['warnings', 'warning'],
			['infos', 'information'],
		]) {
			expect(() =>
				validateZeroDiagnosticReport(
					report(
						{ [field]: 1 },
						[{ severity, category: 'test/diagnostic', message: `${severity} diagnostic` }],
					),
				),
			).toThrow('Biome emitted');
		}
	});

	test('rejects skipped, omitted, and structurally incomplete scans', () => {
		expect(() => validateZeroDiagnosticReport(report({ skipped: 1 }))).toThrow('skipped 1');
		expect(() =>
			validateZeroDiagnosticReport(report({ diagnosticsNotPrinted: 1 })),
		).toThrow('omitted 1');
		expect(() =>
			validateZeroDiagnosticReport(report({ warnings: 1 }, [])),
		).toThrow('serialized 0');
		expect(() =>
			validateZeroDiagnosticReport(report({ unchanged: 0 })),
		).toThrow('zero files');
	});

	test('rejects empty catches even when comments disguise the empty body', () => {
		expect(findEmptyCatchBlocks('try { work(); } catch {}')).toHaveLength(1);
		expect(
			findEmptyCatchBlocks('try { work(); } catch (error) { /* ignore */ }'),
		).toHaveLength(1);
		expect(
			findEmptyCatchBlocks('try { work(); } catch { ; void 0; ignored:; }'),
		).toHaveLength(1);
		expect(
			findEmptyCatchBlocks(
				'try { work(); } catch (error) { console.error(error); }',
			),
		).toHaveLength(0);
		expect(
			findEmptyCatchBlocks(
				'try { return JSON.parse(value); } catch { return null; }',
			),
		).toHaveLength(0);
	});

	test('rejects empty promise rejection handlers without flagging real handling', () => {
		expect(
			findEmptyRejectionHandlers('work().catch(() => {});'),
		).toHaveLength(1);
		expect(
			findEmptyRejectionHandlers('work().then(useValue, function () { /* ignore */ });'),
		).toHaveLength(1);
		expect(
			findEmptyRejectionHandlers('work().catch(() => { void 0; });'),
		).toHaveLength(1);
		expect(
			findEmptyRejectionHandlers('work().catch(() => undefined);'),
		).toHaveLength(0);
		expect(
			findEmptyRejectionHandlers(
				'work().catch((error) => { console.error(error); });',
			),
		).toHaveLength(0);
		expect(
			findEmptyRejectionHandlers(
				'work().then(useValue, () => fallbackValue);',
			),
		).toHaveLength(0);
	});
});
