import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createRelease, createStoredArchive } from '../scripts/create-release.mjs';
import {
	consumePromotionReceipt,
	extractStoredZip,
	promoteStagedRelease,
	runReleaseSmoke,
	validatePromotionReceipt,
	verifyChecksum,
} from '../scripts/smoke-release.mjs';
import {
	assertReleaseRuntime,
	computeReleaseSourceDigest,
	createReleaseReceiptDocument,
	EXPECTED_BUN_VERSION,
	PRODUCTION_REMOTE_SITE_BASE_URL,
	RELEASE_RECEIPT_CAPABILITY_ENV,
	RELEASE_RECEIPT_PATH_ENV,
	RELEASE_REQUIRED_GATE_LABELS,
	RELEASE_SOURCE_DIGEST_ENV,
	RELEASE_STEPS,
	runRelease,
} from '../../../scripts/release-spectra.mjs';
import {
	extractExpectedContentSecurityPolicy,
	extractExpectedSecurityHeaders,
	parseRemoteSiteCheckArgs,
	REMOTE_SITE_ASSET_PATHS,
	REMOTE_SITE_BASE_URL_ENV,
	REMOTE_SITE_SECURITY_HEADER_NAMES,
	verifyRemoteSiteDeployment,
} from '../../../scripts/check-spectra-remote-live.mjs';
import {
	BUNDLE_BUDGETS,
	bundleFootprint,
	checkBundleBudget,
} from '../scripts/check-bundle-budget.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe('release ZIP tooling', () => {
	test('forbids publishing an unvalidated ZIP directly', () => {
		expect(() => createRelease({ stage: false })).toThrow('Direct final release writes are disabled');
	});

	test('creates deterministic stored ZIPs and verifies the extracted payload', () => {
		const entries = [
			{ name: 'background.js', data: Buffer.from('export {};\n') },
			{ name: 'manifest.json', data: Buffer.from('{"manifest_version":3}\n') },
		];
		const first = createStoredArchive(entries);
		const second = createStoredArchive([...entries].reverse());
		expect(first.equals(second)).toBe(true);
		expect(first.readUInt16LE(10)).toBe(0);
		expect(first.readUInt16LE(12)).toBe(33);
		const centralOffset = first.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
		expect(centralOffset).toBeGreaterThan(0);
		expect(first.readUInt16LE(centralOffset + 12)).toBe(0);
		expect(first.readUInt16LE(centralOffset + 14)).toBe(33);

		const directory = temporaryDirectory();
		const archivePath = resolve(directory, 'spectra-test.zip');
		const checksumPath = `${archivePath}.sha256`;
		writeFileSync(archivePath, first);
		const digest = createHash('sha256').update(first).digest('hex');
		writeFileSync(checksumPath, `${digest}  spectra-test.zip\n`);

		expect(verifyChecksum(archivePath, checksumPath)).toBe(digest);
		const extracted = resolve(directory, 'extracted');
		expect(extractStoredZip(archivePath, extracted)).toEqual({
			entryCount: 2,
			totalExtracted: entries.reduce((sum, entry) => sum + entry.data.length, 0),
		});
		expect(readFileSync(resolve(extracted, 'manifest.json'), 'utf8')).toBe('{"manifest_version":3}\n');
	});

	test('rejects duplicate ZIP entries', () => {
		expect(() => createStoredArchive([
			{ name: 'manifest.json', data: Buffer.from('{}') },
			{ name: 'manifest.json', data: Buffer.from('{}') },
		])).toThrow('Duplicate ZIP entry');
	});

	test('rejects traversal paths before writing outside the extraction root', () => {
		const archive = createStoredArchive([
			{ name: '../escape.txt', data: Buffer.from('unsafe') },
			{ name: 'manifest.json', data: Buffer.from('{}') },
		]);
		const directory = temporaryDirectory();
		const archivePath = resolve(directory, 'malicious.zip');
		writeFileSync(archivePath, archive);
		expect(() => extractStoredZip(archivePath, resolve(directory, 'extracted'))).toThrow('Unsafe ZIP entry path');
	});
});

describe('production bundle budget', () => {
	test('tracks the passive bootstrap and lazy content runtime independently', () => {
		expect(Object.keys(BUNDLE_BUDGETS)).toEqual([
			'background.js',
			'content-bootstrap.js',
			'content-runtime.js',
			'popup.js',
			'offscreen.js',
			'options.js',
		]);
		expect(BUNDLE_BUDGETS['content-bootstrap.js']).toBeLessThan(BUNDLE_BUDGETS['content-runtime.js']);
	});

	test('charges shared ESM chunks to every entrypoint that loads them', () => {
		const directory = temporaryDirectory();
		mkdirSync(resolve(directory, 'chunks'));
		writeFileSync(resolve(directory, 'popup.js'), 'import "./chunks/shared.js";\n');
		writeFileSync(resolve(directory, 'chunks/shared.js'), 'export const shared = true;\n');
		const footprint = bundleFootprint(directory, 'popup.js');
		expect(footprint.files.map((path) => path.replaceAll('\\', '/'))).toEqual([
			resolve(directory, 'popup.js').replaceAll('\\', '/'),
			resolve(directory, 'chunks/shared.js').replaceAll('\\', '/'),
		]);
		expect(footprint.bytes).toBe(
			readFileSync(resolve(directory, 'popup.js')).byteLength
			+ readFileSync(resolve(directory, 'chunks/shared.js')).byteLength,
		);
	});

	test('fails with an actionable error when a required split bundle is missing', () => {
		const directory = temporaryDirectory();
		for (const name of Object.keys(BUNDLE_BUDGETS).filter((name) => name !== 'content-runtime.js')) {
			writeFileSync(resolve(directory, name), '');
		}
		expect(() => checkBundleBudget({ distDir: directory })).toThrow(
			'content-runtime.js: required production bundle is missing',
		);
	});
});

describe('release promotion transaction', () => {
	test('restores the exact previous release pair after every rename failure point', () => {
		for (const failAt of [1, 2, 3, 4]) {
			const fixture = promotionFixture();
			let renameCount = 0;
			expect(() => promoteStagedRelease(
				fixture.stagedArchivePath,
				fixture.stagedChecksumPath,
				fixture.stagedDigest,
				{
					releaseDirectory: fixture.directory,
					archiveFileName: fixture.archiveName,
					operations: {
						rename(source: string, destination: string) {
							renameCount += 1;
							if (renameCount === failAt) throw new Error(`injected rename failure ${failAt}`);
							renameSync(source, destination);
						},
					},
				},
			)).toThrow(`injected rename failure ${failAt}`);

			expect(readFileSync(fixture.finalArchivePath).equals(fixture.previousArchive)).toBe(true);
			expect(readFileSync(fixture.finalChecksumPath, 'utf8')).toBe(fixture.previousChecksum);
			expect(existsSync(`${fixture.finalArchivePath}.previous-${process.pid}`)).toBe(false);
			expect(existsSync(`${fixture.finalChecksumPath}.previous-${process.pid}`)).toBe(false);
		}
	});

	test('commits a verified pair and removes only transaction artifacts after success', () => {
		const fixture = promotionFixture();
		const promoted = promoteStagedRelease(
			fixture.stagedArchivePath,
			fixture.stagedChecksumPath,
			fixture.stagedDigest,
			{ releaseDirectory: fixture.directory, archiveFileName: fixture.archiveName },
		);

		expect(promoted).toEqual({
			finalArchive: fixture.finalArchivePath,
			finalChecksum: fixture.finalChecksumPath,
		});
		expect(verifyChecksum(fixture.finalArchivePath, fixture.finalChecksumPath)).toBe(fixture.stagedDigest);
		expect(existsSync(resolve(fixture.directory, '.staging'))).toBe(false);
	});

	test('restores the previous release when frozen source changes during promotion', () => {
		const fixture = promotionFixture();
		let sourceChecks = 0;
		expect(() => promoteStagedRelease(
			fixture.stagedArchivePath,
			fixture.stagedChecksumPath,
			fixture.stagedDigest,
			{
				releaseDirectory: fixture.directory,
				archiveFileName: fixture.archiveName,
				assertSourceUnchanged() {
					sourceChecks += 1;
					if (sourceChecks === 2) throw new Error('injected source drift');
				},
			},
		)).toThrow('injected source drift');

		expect(sourceChecks).toBe(2);
		expect(readFileSync(fixture.finalArchivePath).equals(fixture.previousArchive)).toBe(true);
		expect(readFileSync(fixture.finalChecksumPath, 'utf8')).toBe(fixture.previousChecksum);
		expect(existsSync(`${fixture.finalArchivePath}.previous-${process.pid}`)).toBe(false);
		expect(existsSync(`${fixture.finalChecksumPath}.previous-${process.pid}`)).toBe(false);
	});
});

describe('one-time release receipt', () => {
	test('authenticates all release facts and cannot be consumed twice', () => {
		const directory = temporaryReceiptDirectory();
		const receiptPath = resolve(directory, 'receipt.json');
		const capability = 'a'.repeat(64);
		const now = 1_750_000_000_000;
		const facts = {
			archivePath: resolve(directory, 'spectra-test.zip'),
			archiveSha256: '1'.repeat(64),
			checksumSha256: '2'.repeat(64),
			lockfileSha256: '3'.repeat(64),
			sourceSha256: '4'.repeat(64),
		};
		const receipt = createReleaseReceiptDocument(facts, capability, {
			now,
			nonce: '5'.repeat(32),
		});
		writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);

		expect(validatePromotionReceipt({ receiptPath, capability, expectedFacts: facts, now })).toEqual(receipt);
		expect(() => validatePromotionReceipt({
			receiptPath,
			capability,
			expectedFacts: { ...facts, sourceSha256: '6'.repeat(64) },
			now,
		})).toThrow('bound to different inputs');

		const consumed = consumePromotionReceipt({ receiptPath, capability, expectedFacts: facts, now });
		expect(existsSync(receiptPath)).toBe(false);
		expect(existsSync(consumed.consumedPath)).toBe(true);
		expect(() => consumePromotionReceipt({ receiptPath, capability, expectedFacts: facts, now }))
			.toThrow('already consumed');
	});

	test('binds every scoped source root, including the remote site', () => {
		const extensionSource = temporaryDirectory();
		const remoteSource = temporaryDirectory();
		writeFileSync(resolve(extensionSource, 'extension.ts'), 'export const version = 1;\n');
		writeFileSync(resolve(remoteSource, 'app.js'), 'const protocol = 2;\n');
		const first = computeReleaseSourceDigest([extensionSource, remoteSource]);
		writeFileSync(resolve(remoteSource, 'app.js'), 'const protocol = 3;\n');
		const second = computeReleaseSourceDigest([extensionSource, remoteSource]);
		expect(second).not.toBe(first);
	});

	test('ignores TypeScript incremental build metadata without ignoring source changes', () => {
		const source = temporaryDirectory();
		const sourcePath = resolve(source, 'index.ts');
		writeFileSync(sourcePath, 'export const version = 1;\n');
		const beforeBuild = computeReleaseSourceDigest(source);

		writeFileSync(resolve(source, 'tsconfig.tsbuildinfo'), '{"generated":true}\n');
		expect(computeReleaseSourceDigest(source)).toBe(beforeBuild);

		writeFileSync(sourcePath, 'export const version = 2;\n');
		expect(computeReleaseSourceDigest(source)).not.toBe(beforeBuild);
	});
});

describe('release gate orchestration', () => {
	test('pins Bun and promotes only after every preceding gate', () => {
		expect(EXPECTED_BUN_VERSION).toBe('1.3.14');
		expect(PRODUCTION_REMOTE_SITE_BASE_URL).toBe('https://nexus-remote.pages.dev/');
		expect(() => assertReleaseRuntime('1.3.6')).toThrow('requires Bun 1.3.14');
		expect(RELEASE_STEPS.map((step) => step.label)).toEqual([
			'architecture verify',
			'frozen dependency install',
			'toolchain verify',
			'Biome lint',
			'workspace dependency build',
			'TypeScript check',
			'unit and contract tests',
			'Chrome integration',
			'production build',
			'bundle budget',
			'dependency audit',
			'remote-site live deployment',
			'deterministic staging ZIP',
			'extracted ZIP Chrome smoke and promotion',
		]);
		expect(RELEASE_REQUIRED_GATE_LABELS).toEqual(RELEASE_STEPS.slice(0, -1).map((step) => step.label));
		expect(RELEASE_STEPS.at(-1)?.requiresReceipt).toBe(true);
		expect(RELEASE_STEPS.find((step) => step.label === 'remote-site live deployment')?.args).toEqual([
			'scripts/check-spectra-remote-live.mjs',
			'--base-url',
			PRODUCTION_REMOTE_SITE_BASE_URL,
		]);
		expect(RELEASE_STEPS.at(-1)?.args).toEqual([
			'apps/extension-spectra/scripts/smoke-release.mjs',
			'--stage',
			'--promote',
		]);

		const packageJson = JSON.parse(readFileSync(resolve(import.meta.dir, '../package.json'), 'utf8'));
		expect(packageJson.scripts.test).toBe('bun run test:unit && bun run test:chrome');
		expect(RELEASE_STEPS.find((step) => step.label === 'unit and contract tests')?.args).toEqual([
			'run',
			'--cwd',
			'apps/extension-spectra',
			'test:unit',
		]);
		expect(RELEASE_STEPS.find((step) => step.label === 'Chrome integration')?.args).toEqual([
			'run',
			'--cwd',
			'apps/extension-spectra',
			'test:chrome',
		]);
		expect(Object.keys(packageJson.scripts).filter((name) => name.endsWith(':stage'))).toEqual(['package:stage']);
		const previousPath = process.env[RELEASE_RECEIPT_PATH_ENV];
		const previousCapability = process.env[RELEASE_RECEIPT_CAPABILITY_ENV];
		delete process.env[RELEASE_RECEIPT_PATH_ENV];
		delete process.env[RELEASE_RECEIPT_CAPABILITY_ENV];
		try {
			expect(() => runReleaseSmoke({ stage: true, promote: true })).toThrow('requires a one-time receipt');
		} finally {
			if (previousPath === undefined) delete process.env[RELEASE_RECEIPT_PATH_ENV];
			else process.env[RELEASE_RECEIPT_PATH_ENV] = previousPath;
			if (previousCapability === undefined) delete process.env[RELEASE_RECEIPT_CAPABILITY_ENV];
			else process.env[RELEASE_RECEIPT_CAPABILITY_ENV] = previousCapability;
		}
	});

	test('stops at a failed live deployment check before invoking staging', () => {
		const invoked: string[][] = [];
		let cleanupCalls = 0;
		let remoteEnvironment: NodeJS.ProcessEnv | undefined;
		const previousOverride = process.env[REMOTE_SITE_BASE_URL_ENV];
		process.env[REMOTE_SITE_BASE_URL_ENV] = 'http://127.0.0.1:1234';
		try {
				expect(() => runRelease({
				runtimeVersion: EXPECTED_BUN_VERSION,
				spawnProcess(_executable: string, args: string[], options: { env?: NodeJS.ProcessEnv }) {
					invoked.push(args);
					if (args[0] === 'scripts/check-spectra-remote-live.mjs') remoteEnvironment = options.env;
					return { status: args[0] === 'scripts/check-spectra-remote-live.mjs' ? 1 : 0 };
				},
				cleanupStaging() {
					cleanupCalls += 1;
				},
			})).toThrow('stopped at remote-site live deployment');
		} finally {
			if (previousOverride === undefined) delete process.env[REMOTE_SITE_BASE_URL_ENV];
			else process.env[REMOTE_SITE_BASE_URL_ENV] = previousOverride;
		}
		expect(invoked.at(-1)).toEqual([
			'scripts/check-spectra-remote-live.mjs',
			'--base-url',
			PRODUCTION_REMOTE_SITE_BASE_URL,
		]);
		expect(remoteEnvironment?.[REMOTE_SITE_BASE_URL_ENV]).toBeUndefined();
		expect(remoteEnvironment?.[RELEASE_SOURCE_DIGEST_ENV]).toMatch(/^[a-f0-9]{64}$/u);
		expect(invoked.some((args) => args.includes('package:stage'))).toBe(false);
		expect(cleanupCalls).toBe(2);
	});

	test('removes staging before and after a failed archive staging step', () => {
		const invoked: string[][] = [];
		let cleanupCalls = 0;
		expect(() => runRelease({
			runtimeVersion: EXPECTED_BUN_VERSION,
			spawnProcess(_executable: string, args: string[]) {
				invoked.push(args);
				return { status: args.includes('package:stage') ? 1 : 0 };
			},
			readSourceDigest: () => 'a'.repeat(64),
			cleanupStaging() {
				cleanupCalls += 1;
			},
		})).toThrow('stopped at deterministic staging ZIP');
		expect(invoked.at(-1)).toEqual(['run', '--cwd', 'apps/extension-spectra', 'package:stage']);
		expect(cleanupCalls).toBe(2);
	});

	test('stops when release sources change after a successful gate', () => {
		const invoked: string[][] = [];
		let digestReadCount = 0;
		let cleanupCalls = 0;
		expect(() => runRelease({
			runtimeVersion: EXPECTED_BUN_VERSION,
			spawnProcess(_executable: string, args: string[]) {
				invoked.push(args);
				return { status: 0 };
			},
			readSourceDigest() {
				digestReadCount += 1;
				return digestReadCount === 1 ? 'frozen-source' : 'changed-source';
			},
			cleanupStaging() {
				cleanupCalls += 1;
			},
		})).toThrow('source changed during architecture verify');
		expect(invoked).toEqual([['run', 'verify:v']]);
		expect(cleanupCalls).toBe(2);
	});
});

describe('remote-site live deployment gate', () => {
	test('accepts the byte-identical root and assets with expected MIME and security headers', async () => {
		const fixture = remoteSiteFixture();
		const server = remoteSiteServer(fixture.directory, {
			securityHeaders: fixture.securityHeaders,
		});
		try {
			const result = await verifyRemoteSiteDeployment({
				baseUrl: `http://127.0.0.1:${server.port}`,
				siteDirectory: fixture.directory,
				cacheToken: 'release-tooling-success',
			});
			expect(result.root.assetPath).toBe('/');
			expect(result.root.localAssetPath).toBe('index.html');
			expect(result.root.localSha256).toBe(result.root.remoteSha256);
			expect(result.files.map((file: { assetPath: string }) => file.assetPath))
				.toEqual([...REMOTE_SITE_ASSET_PATHS]);
			expect(result.files.every((file: { localSha256: string; remoteSha256: string }) => (
				file.localSha256 === file.remoteSha256
			))).toBe(true);
			expect(Object.keys(result.expectedHeaders)).toEqual([...REMOTE_SITE_SECURITY_HEADER_NAMES]);
			expect(result.expectedHeaders).toEqual(fixture.securityHeaders);
		} finally {
			server.stop(true);
		}
	});

	test('rejects an HTML fallback and security-header drift with actionable diagnostics', async () => {
		const fixture = remoteSiteFixture();
		const server = remoteSiteServer(fixture.directory, {
			htmlFallback: true,
			securityHeaders: {
				...fixture.securityHeaders,
				'Content-Security-Policy': "default-src 'self'",
				'Referrer-Policy': 'origin',
			},
		});
		try {
			const error = await verifyRemoteSiteDeployment({
				baseUrl: `http://127.0.0.1:${server.port}`,
				siteDirectory: fixture.directory,
				cacheToken: 'release-tooling-failure',
			}).catch((caught) => caught as Error);
			expect(error.message).toContain('app.js SHA-256 mismatch');
			expect(error.message).toContain('app.js Content-Type mismatch');
			expect(error.message).toContain('Content-Security-Policy mismatch');
			expect(error.message).toContain('Referrer-Policy mismatch');
		} finally {
			server.stop(true);
		}
	});

	test('rejects a root route that is not the local index document', async () => {
		const fixture = remoteSiteFixture();
		const server = remoteSiteServer(fixture.directory, {
			rootBody: '<!doctype html><title>stale deployment</title>\n',
			securityHeaders: fixture.securityHeaders,
		});
		try {
			await expect(verifyRemoteSiteDeployment({
				baseUrl: `http://127.0.0.1:${server.port}`,
				siteDirectory: fixture.directory,
				cacheToken: 'release-tooling-root-drift',
			})).rejects.toThrow('/ SHA-256 mismatch');
		} finally {
			server.stop(true);
		}
	});

	test('rejects a cross-origin redirect without following it', async () => {
		const fixture = remoteSiteFixture();
		const server = remoteSiteServer(fixture.directory, {
			redirects: { 'app.js': 'https://outside.invalid/app.js' },
			securityHeaders: fixture.securityHeaders,
		});
		try {
			await expect(verifyRemoteSiteDeployment({
				baseUrl: `http://127.0.0.1:${server.port}`,
				siteDirectory: fixture.directory,
				cacheToken: 'release-tooling-cross-origin-redirect',
			})).rejects.toThrow('app.js request failed: redirected outside');
		} finally {
			server.stop(true);
		}
	});

	test('uses CLI base URL over the environment override and parses every /* security header', () => {
		expect(parseRemoteSiteCheckArgs(
			[],
			{ [REMOTE_SITE_BASE_URL_ENV]: 'http://127.0.0.1:1234' },
		).baseUrl).toBe('http://127.0.0.1:1234/');
		const parsed = parseRemoteSiteCheckArgs(
			['--base-url', 'http://127.0.0.1:4567/test'],
			{ [REMOTE_SITE_BASE_URL_ENV]: 'http://127.0.0.1:1234' },
		);
		expect(parsed.baseUrl).toBe('http://127.0.0.1:4567/test/');
		const expectedHeaders = remoteSiteSecurityHeaders();
		const source = [
			'/private/*',
			"  Content-Security-Policy: default-src 'self'",
			'/*',
			...Object.entries(expectedHeaders).map(([name, value]) => `  ${name}: ${value}`),
		].join('\n');
		expect(extractExpectedSecurityHeaders(source)).toEqual(expectedHeaders);
		expect(extractExpectedContentSecurityPolicy(source))
			.toBe(expectedHeaders['Content-Security-Policy']);
		expect(extractExpectedContentSecurityPolicy([
			'/private/*',
			"  Content-Security-Policy: default-src 'self'",
			'/*',
			`  Content-Security-Policy: ${expectedHeaders['Content-Security-Policy']}`,
		].join('\n'))).toBe(expectedHeaders['Content-Security-Policy']);
		expect(() => extractExpectedSecurityHeaders(source.replace(
			`  X-Frame-Options: ${expectedHeaders['X-Frame-Options']}`,
			'',
		))).toThrow('must define exactly one /* X-Frame-Options, found 0');
	});
});

function archiveWithMarker(marker: string): Buffer {
	return createStoredArchive([
		{ name: 'background.js', data: Buffer.from(`export const marker = ${JSON.stringify(marker)};\n`) },
		{ name: 'manifest.json', data: Buffer.from('{"manifest_version":3}\n') },
	]);
}

function checksumFor(archive: Buffer, archiveName: string): { digest: string; line: string } {
	const digest = createHash('sha256').update(archive).digest('hex');
	return { digest, line: `${digest}  ${archiveName}\n` };
}

function promotionFixture() {
	const directory = temporaryDirectory();
	const archiveName = 'spectra-test.zip';
	const finalArchivePath = resolve(directory, archiveName);
	const finalChecksumPath = `${finalArchivePath}.sha256`;
	const stagingDirectory = resolve(directory, '.staging');
	const stagedArchivePath = resolve(stagingDirectory, archiveName);
	const stagedChecksumPath = `${stagedArchivePath}.sha256`;
	mkdirSync(stagingDirectory, { recursive: true });

	const previousArchive = archiveWithMarker('previous');
	const previousChecksum = checksumFor(previousArchive, archiveName).line;
	writeFileSync(finalArchivePath, previousArchive);
	writeFileSync(finalChecksumPath, previousChecksum);

	const stagedArchive = archiveWithMarker('candidate');
	const stagedChecksum = checksumFor(stagedArchive, archiveName);
	writeFileSync(stagedArchivePath, stagedArchive);
	writeFileSync(stagedChecksumPath, stagedChecksum.line);

	return {
		directory,
		archiveName,
		finalArchivePath,
		finalChecksumPath,
		previousArchive,
		previousChecksum,
		stagedArchivePath,
		stagedChecksumPath,
		stagedDigest: stagedChecksum.digest,
	};
}

function temporaryReceiptDirectory(): string {
	const directory = mkdtempSync(resolve(tmpdir(), 'spectra-release-receipt-'));
	temporaryDirectories.push(directory);
	return directory;
}

function temporaryDirectory(): string {
	const directory = mkdtempSync(resolve(tmpdir(), 'spectra-release-tooling-'));
	temporaryDirectories.push(directory);
	return directory;
}

function remoteSiteSecurityHeaders(): Record<string, string> {
	return {
		'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'",
		'Referrer-Policy': 'no-referrer',
		'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=()',
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Cross-Origin-Opener-Policy': 'same-origin',
	};
}

function remoteSiteFixture(): { directory: string; securityHeaders: Record<string, string> } {
	const directory = temporaryDirectory();
	mkdirSync(resolve(directory, 'vendor'), { recursive: true });
	const securityHeaders = remoteSiteSecurityHeaders();
	writeFileSync(resolve(directory, '_headers'), [
		'/*',
		...Object.entries(securityHeaders).map(([name, value]) => `  ${name}: ${value}`),
		'',
	].join('\n'));
	writeFileSync(resolve(directory, 'index.html'), '<!doctype html><title>SPECTRA Remote</title>\n');
	writeFileSync(resolve(directory, 'app.js'), 'globalThis.spectraRemote = true;\n');
	writeFileSync(resolve(directory, 'styles.css'), 'body { color: CanvasText; }\n');
	writeFileSync(resolve(directory, 'vendor/peerjs.min.js'), 'globalThis.Peer = class Peer {};\n');
	return { directory, securityHeaders };
}

function remoteSiteContentType(assetPath: string): string {
	if (assetPath.endsWith('.html')) return 'text/html; charset=utf-8';
	if (assetPath.endsWith('.css')) return 'text/css; charset=utf-8';
	return 'text/javascript; charset=utf-8';
}

function remoteSiteServer(directory: string, options: {
	securityHeaders: Record<string, string>;
	htmlFallback?: boolean;
	redirects?: Record<string, string>;
	rootBody?: string;
}) {
	return Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const pathname = new URL(request.url).pathname;
			const assetPath = pathname === '/' ? '/' : pathname.slice(1);
			const redirectLocation = options.redirects?.[assetPath];
			if (redirectLocation) {
				return new Response(null, { status: 302, headers: { Location: redirectLocation } });
			}
			if (assetPath !== '/' && !REMOTE_SITE_ASSET_PATHS.includes(assetPath)) {
				return new Response('Not found', { status: 404 });
			}
			const localPath = assetPath === '/' ? 'index.html' : assetPath;
			const servedPath = options.htmlFallback && localPath !== 'index.html'
				? 'index.html'
				: localPath;
			const headers = new Headers(options.securityHeaders);
			headers.set('Content-Type', remoteSiteContentType(servedPath));
			const body = assetPath === '/' && options.rootBody !== undefined
				? options.rootBody
				: Bun.file(resolve(directory, ...servedPath.split('/')));
			return new Response(body, { headers });
		},
	});
}
