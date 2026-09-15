import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { minify } from 'terser';
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
import { relative, resolve } from 'node:path';
import { createRelease, createStoredArchive } from '../scripts/create-release.ts';
import {
	consumePromotionReceipt,
	extractStoredZip,
	promoteStagedRelease,
	runReleaseSmoke,
	validatePromotionReceipt,
	verifyChecksum,
} from '../scripts/smoke-release.ts';
import {
	assertReleaseRuntime,
	computeReleaseSourceDigest,
	type createCandidateReceipt,
	createCandidateReceiptDocument,
	currentCandidateFacts,
	createReleaseReceiptDocument,
	EXPECTED_BUN_VERSION,
	PRODUCTION_REMOTE_SITE_BASE_URL,
	readReleaseTreeIdentity,
	validateCandidateReceipt,
	RELEASE_RECEIPT_CAPABILITY_ENV,
	RELEASE_RECEIPT_PATH_ENV,
	RELEASE_REQUIRED_GATE_LABELS,
	RELEASE_SOURCE_DIGEST_ENV,
	RELEASE_STEPS,
	SPECTRA_RELEASE_PATHS,
	runRelease,
} from '../../../scripts/release-spectra.ts';
import {
	extractExpectedContentSecurityPolicy,
	extractExpectedSecurityHeaders,
	parseRemoteSiteCheckArgs,
	REMOTE_SITE_ASSET_PATHS,
	REMOTE_SITE_BASE_URL_ENV,
	REMOTE_SITE_SECURITY_HEADER_NAMES,
	verifyRemoteSiteDeployment,
} from '../../../scripts/check-spectra-remote-live.ts';
import {
	analyzeProductionArtifacts,
	assertProductionArtifactReport,
	artifactClosure,
	bundleFootprint,
	checkProductionArtifacts,
	productionSizeSignals,
	productionSizePolicy,
} from '../scripts/check-production-artifacts.ts';
import { productionMangleOptions } from '../scripts/minification-policy.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
});

describe('release ZIP tooling', () => {
	test('keeps runtime control roles bound to browser sender identity', () => {
		const coordinator = readFileSync(
			new URL('../src/background/control-coordinator.ts', import.meta.url),
			'utf8',
		);
		expect(coordinator).toContain("runtimeClaimedSource === 'remote' || runtimeClaimedSource === 'system'");
		expect(coordinator).toContain('Background-only control sources cannot be asserted by runtime RPC');
		expect(coordinator).toMatch(/message\.payload\.source === 'restore'[\s\S]{0,320}sender\.frameId !== 0[\s\S]{0,320}message\.payload\.target\.documentId !== sender\.documentId/u);
		expect(coordinator).toMatch(/pageSource[\s\S]{0,240}sender\.frameId !== 0[\s\S]{0,240}sender\.documentId/u);
		const legacyHandler = readFileSync(
			new URL('../src/content/logic/spectra-command-handler.ts', import.meta.url),
			'utf8',
		);
		expect(legacyHandler).not.toContain("source: 'popup'");
		expect(legacyHandler).toContain('legacy_command_retired');
	});

	test('advances remote delivered generation only inside a successful delivery acknowledgement', () => {
		const remote = readFileSync(
			new URL('../src/background/remote-service.ts', import.meta.url),
			'utf8',
		);
		const sendState = remote.slice(
			remote.indexOf('function sendStateToOffscreen'),
			remote.indexOf('type AuthorizedRemoteHostEvent'),
		);
		expect(sendState).toMatch(/const response = await sendOffscreenMessage\([\s\S]*if \(!response\.success\)[\s\S]*throw new Error/u);
		expect(sendState).toContain('current.session.sessionId !== authorization.session.sessionId');
		expect(sendState.indexOf('current.generation = Math.max')).toBeGreaterThan(sendState.indexOf('response.success'));
		expect(sendState).not.toContain('authorization.generation =');
	});

	test('size is attributable evidence, never a release blocker', () => {
		const policy = productionSizePolicy();
		expect(policy.schemaVersion).toBe(1);
		expect(policy.defaultSignalKiB).toBeGreaterThan(0);
		for (const entry of Object.values(policy.dimensions)) {
			expect(entry.signalKiB).toBeGreaterThan(policy.defaultSignalKiB);
			expect(entry.owner.trim().length).toBeGreaterThan(0);
			expect(entry.rationale.trim().length).toBeGreaterThan(0);
			expect(entry.decompositionTrigger.trim().length).toBeGreaterThan(0);
		}

		const baseline = sizeReport();
		expect(productionSizeSignals(baseline)).toEqual([]);

		// Aggregate totals are evidence only; even an enormous total produces no
		// review signal because it sums many isolated bundles without one owner.
		const aggregateHuge = sizeReport({ javascript: 20 * 1024 * 1024, total: 20 * 1024 * 1024 });
		expect(productionSizeSignals(aggregateHuge)).toEqual([]);

		const grown = sizeReport({ serviceWorkerWake: policy.dimensions.serviceWorkerWake.signalKiB * 1024 + 1 });
		const owned = productionSizeSignals(grown).find((signal) => signal.key === 'serviceWorkerWake');
		expect(owned?.code).toBe('size-over-owned-envelope');
		expect(owned?.owner).toBe('spectra-service-worker');
		expect(owned?.message).toContain('decomposition trigger');

		const unregistered = sizeReport({ offscreenRemote: policy.defaultSignalKiB * 1024 + 1 });
		const reviewWant = productionSizeSignals(unregistered).find((signal) => signal.key === 'offscreenRemote');
		expect(reviewWant?.code).toBe('size-review-desired');

		// A barely-big artifact still passes the structural gate because size is
		// planning evidence. Only reachability/ownership/forbidden-artifact
		// failures throw; a size change is bound by the artifact sha instead.
		const structuralClean = { ...grown, failures: [] };
		expect(() => assertProductionArtifactReport(structuralClean)).not.toThrow();
	});
	test('keeps size governance out of the release path entirely', () => {
		const release = readFileSync(new URL('../../../scripts/release-spectra.ts', import.meta.url), 'utf8');
		expect(release).not.toContain('capacityBlockers');
		expect(release).not.toContain('typed capacity freeze');
		expect(release).not.toContain('SPECTRA_PRODUCTION_BUDGETS');
	});
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

describe('production artifact integrity', () => {
	test('keeps application bundles out of Terser and limits vendor mangling to private names', async () => {
		expect(() => productionMangleOptions(false)).toThrow(
			'Application bundles must not enter the secondary Terser pass',
		);

		const vendor = await minify(
			'globalThis.vendor = { publicMethod() { return this._privateState; }, _privateState: 1 };',
			{
				compress: false,
				mangle: productionMangleOptions(true),
			},
		);
		expect(vendor.code).toContain('publicMethod');
		expect(vendor.code).not.toContain('_privateState');
	});

	test('accepts a fully reachable production graph without a historical byte ceiling', () => {
		const directory = temporaryDirectory();
		writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'background.js' },
			action: { default_popup: 'popup.html' },
		}));
		writeFileSync(resolve(directory, 'background.js'), 'export const background = true;\n');
		writeFileSync(
			resolve(directory, 'popup.html'),
			'<link rel="stylesheet" href="styles.css"><a href="chrome://extensions/shortcuts">Shortcuts</a><script type="module" src="popup.js"></script>\n',
		);
		writeFileSync(resolve(directory, 'styles.css'), 'body{display:block}\n');
		writeFileSync(resolve(directory, 'popup.js'), 'export const popup = true;\n');

		const report = analyzeProductionArtifacts({ distDir: directory });
		expect(report.failures).toEqual([]);
		expect(report.reachable).toBe(report.files);
		expect(report.duplicates).toEqual([]);
		expect(report.outputAttribution).toEqual({
			outputClosures: [],
			sharedInputs: [],
			status: 'not-measured',
		});
		expect(() => assertProductionArtifactReport(report)).not.toThrow();
		expect(() => checkProductionArtifacts({ distDir: directory })).not.toThrow();
	});

	test('budgets Popup and Options scripts without hiding reachable locale payloads', () => {
		const directory = temporaryDirectory();
		mkdirSync(resolve(directory, 'i18n/popup'), { recursive: true });
		mkdirSync(resolve(directory, 'i18n/options'), { recursive: true });
		writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'background.js' },
			action: { default_popup: 'popup.html' },
			options_page: 'options.html',
		}));
		writeFileSync(resolve(directory, 'background.js'), 'globalThis.Background = true;\n');
		writeFileSync(resolve(directory, 'popup.html'), '<script type="module" src="popup.js"></script>\n');
		writeFileSync(resolve(directory, 'options.html'), '<script type="module" src="options.js"></script>\n');
		writeFileSync(
			resolve(directory, 'popup.js'),
			'void fetch(chrome.runtime.getURL("i18n/popup/en-US.json.gz"));\n',
		);
		writeFileSync(
			resolve(directory, 'options.js'),
			'void fetch(chrome.runtime.getURL("i18n/options/en-US.json.gz"));\n',
		);
		writeFileSync(resolve(directory, 'i18n/popup/en-US.json.gz'), 'p'.repeat(160 * 1024));
		writeFileSync(resolve(directory, 'i18n/options/en-US.json.gz'), 'o'.repeat(48 * 1024));

		const report = analyzeProductionArtifacts({ distDir: directory });
		const entries = new Map(report.entrypoints.map((entry) => [entry.name, entry]));
		const popup = entries.get('popup.js');
		const options = entries.get('options.js');
		expect(popup?.possible.bytes).toBeGreaterThan(popup?.possible.scriptBytes ?? 0);
		expect(options?.possible.bytes).toBeGreaterThan(options?.possible.scriptBytes ?? 0);
		expect(popup?.possible.names).toContain('i18n/popup/en-US.json.gz');
		expect(options?.possible.names).toContain('i18n/options/en-US.json.gz');
		expect(popup?.possible.scriptBytes).toBeLessThan(160 * 1024);
		expect(options?.possible.scriptBytes).toBeLessThan(48 * 1024);
		expect(productionSizeSignals(report)).toEqual([]);
	});

	test('reports a typed failure when a metafile output is absent from dist', () => {
		const directory = temporaryDirectory();
		writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'background.js' },
		}));
		writeFileSync(resolve(directory, 'background.js'), 'globalThis.Background = true;\n');
		const report = analyzeProductionArtifacts({
			distDir: directory,
			metafiles: [{
				name: 'extension',
				sharingDomain: 'extension-pages',
				metafile: {
					outputs: {
						'dist/missing.js': {
							entryPoint: 'src/missing.ts',
							inputs: { 'src/missing.ts': { bytesInOutput: 1 } },
						},
					},
				},
			}],
		});
		expect(report.outputAttribution.status).toBe('measured');
		expect(report.failures).toContain('dist/missing.js: metafile output is missing from dist');
		expect(() => assertProductionArtifactReport(report)).toThrow(
			'dist/missing.js: metafile output is missing from dist',
		);
	});

	test('writes analysis outside dist before production gates, including a failing gate', () => {
		const build = readFileSync(new URL('../build.ts', import.meta.url), 'utf8');
		const analysisPath = "resolve(projectDir, '../../../artifacts/spectra-build-analysis.json')";
		const reportCreation = build.indexOf('const report = isAnalyze || !isDev');
		const reportWrite = build.indexOf('writeFileSync(analysisPath');
		const assertionGate = build.indexOf('assertProductionJavaScript();');
		const artifactGate = build.indexOf('assertProductionArtifactReport(report);');

		expect(build).toContain(analysisPath);
		expect(build).not.toContain("resolve(distDir, 'build-analysis.json')");
		const appDirectory = resolve(import.meta.dir, '..');
		const analysisOutput = resolve(appDirectory, '../../../artifacts/spectra-build-analysis.json');
		expect(relative(resolve(appDirectory, 'dist'), analysisOutput)).toMatch(/^\.\./u);
		expect(reportCreation).toBeGreaterThan(-1);
		expect(build.match(/analyzeProductionArtifacts\(\{ distDir, metafiles \}\)/gu)).toHaveLength(1);
		expect(reportWrite).toBeGreaterThan(reportCreation);
		expect(reportWrite).toBeLessThan(assertionGate);
		expect(reportWrite).toBeLessThan(artifactGate);

		const directory = temporaryDirectory();
		writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'background.js' },
		}));
		writeFileSync(resolve(directory, 'background.js'), 'globalThis.SPECTRA_TEST_BACKGROUND = true;\n');
		writeFileSync(resolve(directory, 'build-analysis.json'), '{}\n');
		const report = analyzeProductionArtifacts({ distDir: directory });
		expect(report.failures).toContain('build-analysis.json: development or source artifact is forbidden');
		expect(() => checkProductionArtifacts({ distDir: directory })).toThrow('build-analysis.json: development or source artifact is forbidden');
	});

	test('charges shared ESM chunks to every entrypoint that loads them', () => {
		const directory = temporaryDirectory();
		mkdirSync(resolve(directory, 'chunks'));
		writeFileSync(resolve(directory, 'popup.js'), 'import "./chunks/shared.js";\n');
		writeFileSync(resolve(directory, 'chunks/shared.js'), 'export const shared = true;\n');
		const footprint = bundleFootprint(directory, 'popup.js');
		expect(footprint.files.map((path) => path.replaceAll('\\', '/'))).toEqual([
			resolve(directory, 'chunks/shared.js').replaceAll('\\', '/'),
			resolve(directory, 'popup.js').replaceAll('\\', '/'),
		]);
		expect(footprint.bytes).toBe(
			readFileSync(resolve(directory, 'popup.js')).byteLength
			+ readFileSync(resolve(directory, 'chunks/shared.js')).byteLength,
		);
	});

	test('distinguishes executable loading from URL-only identity references', () => {
		const directory = temporaryDirectory();
		writeFileSync(
			resolve(directory, 'entry.js'),
			'import "./static.js"; void import("./lazy.js");\n',
		);
		writeFileSync(resolve(directory, 'static.js'), 'export const eager = true;\n');
		writeFileSync(
			resolve(directory, 'lazy.js'),
			'chrome.runtime.getURL("peerjs-vendor.js");'
			+ 'void import(chrome.runtime.getURL("runtime-module.js"));'
			+ 'sender.url===chrome.runtime.getURL("background.js");\n',
		);
		writeFileSync(resolve(directory, 'peerjs-vendor.js'), 'const Peer = class Peer {}; export { Peer as default };\n');
		writeFileSync(resolve(directory, 'runtime-module.js'), 'globalThis.RuntimeModule = true;\n');
		writeFileSync(resolve(directory, 'background.js'), 'globalThis.Background = true;\n');

		const startup = artifactClosure(directory, 'entry.js');
		const eventual = artifactClosure(directory, 'entry.js', {
			includeDeferred: true,
			includeRuntimeAssets: true,
		});
		expect(startup.names).toEqual(['entry.js', 'static.js']);
		expect(eventual.names).toEqual([
			'entry.js',
			'lazy.js',
			'peerjs-vendor.js',
			'runtime-module.js',
			'static.js',
		]);
	});

	test('separates worker, document-start, and Remote-only offscreen closures', () => {
		const directory = temporaryDirectory();
		mkdirSync(resolve(directory, 'chunks'));
		writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'background.js', type: 'module' },
			content_scripts: [{ matches: ['<all_urls>'], js: ['content-a.js', 'content-b.js'] }],
		}));
		writeFileSync(
			resolve(directory, 'background.js'),
			'chrome.offscreen.createDocument({url:"offscreen.html"});\n',
		);
		writeFileSync(resolve(directory, 'content-a.js'), 'import "./shared.js"; globalThis.ContentA = true;\n');
		writeFileSync(resolve(directory, 'content-b.js'), 'import "./shared.js"; globalThis.ContentB = true;\n');
		writeFileSync(resolve(directory, 'shared.js'), 'export const shared = true;\n');
		writeFileSync(
			resolve(directory, 'offscreen.html'),
			'<script type="module" src="offscreen.js"></script>\n',
		);
		writeFileSync(
			resolve(directory, 'offscreen.js'),
			'sender.url===chrome.runtime.getURL("background.js");'
			+ 'void import("./chunks/remote.js");\n',
		);
		writeFileSync(
			resolve(directory, 'chunks/remote.js'),
			'void import(chrome.runtime.getURL("peerjs-vendor.js"));\n',
		);
		writeFileSync(resolve(directory, 'peerjs-vendor.js'), 'const Peer = class Peer {}; export { Peer as default };\n');

		const report = analyzeProductionArtifacts({ distDir: directory });
		expect(report.failures).toEqual([]);
		expect(report.serviceWorkerWake.scriptNames).toEqual(['background.js']);
		expect(report.documentStart.scriptNames).toEqual([
			'content-a.js',
			'content-b.js',
			'shared.js',
		]);
		expect(report.offscreenAudioOnly?.scriptNames).toEqual(['offscreen.js']);
		expect(report.offscreenRemote?.scriptNames).toEqual([
			'chunks/remote.js',
			'offscreen.js',
			'peerjs-vendor.js',
		]);
	});

	test('rejects a global Peer vendor or a non-module Remote loader', () => {
		const directory = temporaryDirectory();
		mkdirSync(resolve(directory, 'chunks'));
		writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'background.js', type: 'module' },
		}));
		writeFileSync(
			resolve(directory, 'background.js'),
			'chrome.offscreen.createDocument({url:"offscreen.html"});\n',
		);
		writeFileSync(
			resolve(directory, 'offscreen.html'),
			'<script type="module" src="offscreen.js"></script>\n',
		);
		writeFileSync(resolve(directory, 'offscreen.js'), 'void import("./chunks/remote.js");\n');
		writeFileSync(
			resolve(directory, 'chunks/remote.js'),
			'chrome.runtime.getURL("peerjs-vendor.js");\n',
		);
		writeFileSync(resolve(directory, 'peerjs-vendor.js'), 'globalThis.Peer = class Peer {};\n');

		const report = analyzeProductionArtifacts({ distDir: directory });
		expect(report.failures).toContain(
			'peerjs-vendor.js: exactly one Remote ESM runtime-module owner is required',
		);
		expect(report.failures).toContain(
			'peerjs-vendor.js: ESM runtime module must expose one default export',
		);
		expect(report.failures).toContain('peerjs-vendor.js: global Peer assignment is forbidden');
	});

	test('does not infer runtime loading from a compressed URL-only string binding', () => {
		const directory = temporaryDirectory();
		writeFileSync(
			resolve(directory, 'entry.js'),
			'var asset="peerjs-vendor.js";chrome.runtime.getURL(asset);\n',
		);
		writeFileSync(resolve(directory, 'peerjs-vendor.js'), 'globalThis.Peer = class Peer {};\n');

		const eventual = artifactClosure(directory, 'entry.js', {
			includeDeferred: true,
			includeRuntimeAssets: true,
		});
		expect(eventual.names).toEqual(['entry.js']);
	});

	test('does not mark an artifact reachable from an inert JavaScript string', () => {
		const directory = temporaryDirectory();
		writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'background.js' },
		}));
		writeFileSync(resolve(directory, 'background.js'), 'const diagnostic = "orphan.js"; void diagnostic;\n');
		writeFileSync(resolve(directory, 'orphan.js'), 'export const orphan = true;\n');

		const report = analyzeProductionArtifacts({ distDir: directory });
		expect(report.failures).toContain('orphan.js: unreachable production artifact');
		expect(report.reachable).toBe(2);
	});

	test('rejects an MV3 service worker that depends on a separately initialized chunk', () => {
		const directory = temporaryDirectory();
		mkdirSync(resolve(directory, 'chunks'));
		writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'background.js', type: 'module' },
		}));
		writeFileSync(resolve(directory, 'background.js'), 'import "./chunks/shared.js";\n');
		writeFileSync(resolve(directory, 'chunks/shared.js'), 'export const shared = true;\n');

		const report = analyzeProductionArtifacts({ distDir: directory });
		expect(report.failures).toContain(
			'background.js: MV3 service worker must be one self-contained bundle',
		);
	});

	test('rejects missing, unreachable and byte-identical artifacts with actionable evidence', () => {
		const directory = temporaryDirectory();
		writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'missing.js' },
		}));
		writeFileSync(resolve(directory, 'orphan-a.js'), 'export const duplicate = true;\n');
		writeFileSync(resolve(directory, 'orphan-b.js'), 'export const duplicate = true;\n');

		const report = analyzeProductionArtifacts({ distDir: directory });
		expect(report.failures.join('\n')).toContain('referenced production artifact is missing (missing.js)');
		expect(report.failures.join('\n')).toContain('orphan-a.js: unreachable production artifact');
		expect(report.failures.join('\n')).toContain('byte-identical production artifacts: orphan-a.js, orphan-b.js');
		expect(() => checkProductionArtifacts({ distDir: directory })).toThrow('Production artifact integrity failed');
	});

	test('rejects avoidable module replication inside one shareable build domain', () => {
		const directory = temporaryDirectory();
		writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'background.js' },
		}));
		writeFileSync(resolve(directory, 'background.js'), 'export const background = true;\n');
		const metafile = (output: string) => ({
			outputs: {
				[output]: { inputs: { 'shared-runtime.ts': { bytesInOutput: 12 } } },
			},
		});
		const report = analyzeProductionArtifacts({
			distDir: directory,
			metafiles: [
				{ name: 'popup', sharingDomain: 'extension-pages', metafile: metafile('popup.js') },
				{ name: 'offscreen', sharingDomain: 'extension-pages', metafile: metafile('offscreen.js') },
			],
		});
		expect(report.failures.join('\n')).toContain(
			'shared-runtime.ts: repeated in shareable build domain (popup, offscreen)',
		);
	});

	test('uses metafiles for deterministic output closures and shared source attribution', () => {
		const directory = temporaryDirectory();
		const distDirectory = resolve(directory, 'dist');
		mkdirSync(resolve(distDirectory, 'chunks'), { recursive: true });
		writeFileSync(resolve(distDirectory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			background: { service_worker: 'background.js' },
			content_scripts: [{ matches: ['<all_urls>'], js: ['entry-a.js', 'entry-b.js'] }],
		}));
		writeFileSync(resolve(distDirectory, 'background.js'), 'globalThis.SPECTRA_TEST_BACKGROUND = true;\n');
		writeFileSync(resolve(distDirectory, 'entry-a.js'), 'import "./shared.js"; void import("./chunks/lazy.js");\n');
		writeFileSync(resolve(distDirectory, 'entry-b.js'), 'import "./shared.js"; globalThis.EntryB = true;\n');
		writeFileSync(resolve(distDirectory, 'shared.js'), 'globalThis.Shared = true;\n');
		writeFileSync(resolve(distDirectory, 'chunks/lazy.js'), 'globalThis.Lazy = true;\n');

		const outputs = {
			'dist/entry-a.js': {
				entryPoint: 'src/entry-a.ts',
				imports: [
					{ path: 'dist/shared.js', kind: 'import-statement' },
					{ path: 'dist/chunks/lazy.js', kind: 'dynamic-import' },
				],
				inputs: { 'src/entry-a.ts': { bytesInOutput: 10 } },
			},
			'dist/entry-b.js': {
				entryPoint: 'src/entry-b.ts',
				imports: [{ path: 'dist/shared.js', kind: 'import-statement' }],
				inputs: { 'src/entry-b.ts': { bytesInOutput: 11 } },
			},
			'dist/shared.js': {
				inputs: { 'src/shared.ts': { bytesInOutput: 7 } },
			},
			'dist/chunks/lazy.js': {
				inputs: { 'src/lazy.ts': { bytesInOutput: 5 } },
			},
		};
		const metafiles = [{ name: 'extension', sharingDomain: 'extension-pages', metafile: { outputs } }];
		const first = analyzeProductionArtifacts({ distDir: distDirectory, metafiles });
		expect(first.failures).toEqual([]);
		expect(first.outputAttribution.status).toBe('measured');
		expect(first.outputAttribution.outputClosures).toEqual([
			expect.objectContaining({
				name: 'entry-a.js',
				entryPoint: 'src/entry-a.ts',
				staticOutputClosure: expect.objectContaining({ names: ['entry-a.js', 'shared.js'] }),
				possibleOutputClosure: expect.objectContaining({ names: ['chunks/lazy.js', 'entry-a.js', 'shared.js'] }),
				topStaticContributors: [
					{ path: 'src/entry-a.ts', bytes: 10 },
					{ path: 'src/shared.ts', bytes: 7 },
				],
				topPossibleInputContributors: [
					{ path: 'src/entry-a.ts', bytes: 10 },
					{ path: 'src/shared.ts', bytes: 7 },
					{ path: 'src/lazy.ts', bytes: 5 },
				],
			}),
			expect.objectContaining({
				name: 'entry-b.js',
				entryPoint: 'src/entry-b.ts',
				staticOutputClosure: expect.objectContaining({ names: ['entry-b.js', 'shared.js'] }),
				possibleOutputClosure: expect.objectContaining({ names: ['entry-b.js', 'shared.js'] }),
			}),
		]);
		expect(first.outputAttribution.sharedInputs).toEqual([{
			input: 'src/shared.ts',
			entries: [
				{ build: 'extension', entry: 'entry-a.js', sharingDomain: 'extension-pages', staticBytes: 7, possibleBytes: 7 },
				{ build: 'extension', entry: 'entry-b.js', sharingDomain: 'extension-pages', staticBytes: 7, possibleBytes: 7 },
			],
			totalStaticBytes: 14,
			totalPossibleAttributionBytes: 14,
		}]);

		const reversedOutputs = Object.fromEntries(Object.entries(outputs).reverse());
		const second = analyzeProductionArtifacts({
			distDir: distDirectory,
			metafiles: [{ name: 'extension', sharingDomain: 'extension-pages', metafile: { outputs: reversedOutputs } }],
		});
		expect(second.outputAttribution).toEqual(first.outputAttribution);
		expect(second.artifactSha256).toBe(first.artifactSha256);
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
			commitOid: '7'.repeat(40),
			treeOid: '8'.repeat(40),
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

	test('binds production Chrome smoke to the exact source tree and dist bytes', () => {
		const directory = temporaryCandidateReceiptDirectory();
		const distDirectory = resolve(directory, 'dist');
		mkdirSync(distDirectory);
		const packageVersion = JSON.parse(readFileSync(
			resolve(import.meta.dir, '../package.json'),
			'utf8',
		)).version as string;
		writeFileSync(resolve(distDirectory, 'manifest.json'), JSON.stringify({
			manifest_version: 3,
			version: packageVersion,
			background: { service_worker: 'background.js' },
			action: { default_popup: 'popup.html' },
		}));
		writeFileSync(resolve(distDirectory, 'background.js'), 'globalThis.SPECTRA_TEST_BACKGROUND = true;\n');
		writeFileSync(resolve(distDirectory, 'popup.html'), `v${packageVersion} • Prod\n`);
		const identity = {
			commitOid: '9'.repeat(40),
			treeOid: 'a'.repeat(40),
			sourceSha256: 'b'.repeat(64),
		};
		const facts = currentCandidateFacts(identity, distDirectory);
		const capability = 'c'.repeat(64);
		const now = 1_750_000_000_000;
		const receipt = createCandidateReceiptDocument(facts, capability, {
			now,
			nonce: 'd'.repeat(32),
		});
		const receiptPath = resolve(directory, 'receipt.json');
		writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);

		expect(validateCandidateReceipt({
			receiptPath,
			capability,
			expectedFacts: facts,
			now,
		})).toEqual(receipt);
		writeFileSync(resolve(distDirectory, 'popup.html'), `v${packageVersion} • Prod\nchanged\n`);
		expect(() => validateCandidateReceipt({
			receiptPath,
			capability,
			expectedFacts: currentCandidateFacts(identity, distDirectory),
			now,
		})).toThrow('bound to different inputs');
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

	test('freezes only the SPECTRA source closure for release cleanliness', () => {
		expect(SPECTRA_RELEASE_PATHS).toContain('nexus/packages/contracts');
		expect(SPECTRA_RELEASE_PATHS).toContain('nexus/scripts/release-supply-chain.ts');
		expect(SPECTRA_RELEASE_PATHS).toContain('nexus/source-derived-third-party.json');
		expect(SPECTRA_RELEASE_PATHS).not.toContain('nexus/apps/extension-halo');
		const calls: string[][] = [];
		const gitIdentity = (dirtyPath: string) => readReleaseTreeIdentity({
			runGit(args: string[]) {
				calls.push(args);
				if (args[0] === 'status') {
					const inScope = SPECTRA_RELEASE_PATHS.some((scope) => (
						dirtyPath === scope || dirtyPath.startsWith(`${scope}/`)
					));
					return inScope ? ` M ${dirtyPath}` : '';
				}
				return args[1] === 'HEAD' ? 'a'.repeat(40) : 'b'.repeat(40);
			},
			readDigest: () => 'c'.repeat(64),
		});
		const clean = readReleaseTreeIdentity({
			runGit(args: string[]) {
				calls.push(args);
				if (args[0] === 'status') return '';
				return args[1] === 'HEAD' ? 'a'.repeat(40) : 'b'.repeat(40);
			},
			readDigest: () => 'c'.repeat(64),
		});
		expect(clean).toEqual({
			commitOid: 'a'.repeat(40),
			treeOid: 'b'.repeat(40),
			sourceSha256: 'c'.repeat(64),
		});
		const statusArgs = calls[0] ?? [];
		expect(statusArgs).toContain('nexus/packages/contracts');
		expect(statusArgs).not.toContain('nexus/apps/extension-halo');
		expect(gitIdentity('nexus/apps/extension-halo/src/index.ts').commitOid).toBe('a'.repeat(40));
		expect(() => gitIdentity('nexus/packages/contracts/src/index.ts')).toThrow('dirty paths');
	});
});

describe('release gate orchestration', () => {
	test('pins Bun and promotes only after every preceding gate', () => {
		expect(EXPECTED_BUN_VERSION).toBe('1.4.0');
		expect(PRODUCTION_REMOTE_SITE_BASE_URL).toBe('https://nexus-remote.pages.dev/');
		expect(() => assertReleaseRuntime('1.3.6')).toThrow('requires Bun 1.4.0');
		expect(RELEASE_STEPS.map((step) => step.label)).toEqual([
			'architecture verify',
			'documentation architecture',
			'platform contract',
			'repository governance contracts',
			'closeout evidence contracts',
			'public projection contract',
			'frozen dependency install',
			'toolchain verify',
			'Biome lint',
			'workspace dependency build',
			'TypeScript check',
			'unit and contract tests',
			'production build',
			'retained dependency capture',
			'whole-artifact provenance capture',
			'production Chrome integration',
			'dependency audit',
			'remote-site live deployment',
			'deterministic staging ZIP',
			'extracted ZIP Chrome smoke and promotion',
			'final release supply-chain evidence',
		]);
		const promotionIndex = RELEASE_STEPS.findIndex((step) => step.requiresReceipt);
		expect(RELEASE_REQUIRED_GATE_LABELS).toEqual(RELEASE_STEPS.slice(0, promotionIndex).map((step) => step.label));
		expect(RELEASE_STEPS.at(-2)?.requiresReceipt).toBe(true);
		expect(RELEASE_STEPS.at(-1)?.label).toBe('final release supply-chain evidence');
		expect(RELEASE_STEPS.find((step) => step.label === 'remote-site live deployment')?.args).toEqual([
			'scripts/check-spectra-remote-live.ts',
			'--base-url',
			PRODUCTION_REMOTE_SITE_BASE_URL,
		]);
		expect(RELEASE_STEPS.at(-2)?.args).toEqual([
			'apps/extension-spectra/scripts/smoke-release.ts',
			'--stage',
			'--promote',
		]);
		expect(RELEASE_STEPS.at(-1)?.args).toEqual([
			'scripts/release-artifact-provenance.ts',
			'spectra',
		]);

		const packageJson = JSON.parse(readFileSync(resolve(import.meta.dir, '../package.json'), 'utf8'));
		expect(packageJson.scripts.test).toBe('bun run test:unit && bun run test:chrome');
		expect(packageJson.scripts['test:chrome']).toBe('bun run build:dev && bun run test:smoke');
		expect(packageJson.scripts['test:chrome:dist']).toBe('bun scripts/test-chrome-dist.ts');
		expect(packageJson.scripts['test:smoke:en-US']).toBe('bun scripts/run-smoke-locale.ts en-US');
		expect(packageJson.scripts['test:smoke:zh-CN']).toBe('bun scripts/run-smoke-locale.ts zh-CN');
		expect(RELEASE_STEPS.find((step) => step.label === 'unit and contract tests')?.args).toEqual([
			'run',
			'--cwd',
			'apps/extension-spectra',
			'test:unit',
		]);
		expect(RELEASE_STEPS.find((step) => step.label === 'production build')?.args).toEqual([
			'run',
			'--cwd',
			'apps/extension-spectra',
			'build:analyze',
		]);
		expect(RELEASE_STEPS.find((step) => step.label === 'retained dependency capture')?.args).toEqual([
			'scripts/capture-retained-dependencies.ts',
			'spectra',
			'--keep-analysis',
		]);
		expect(RELEASE_STEPS.find((step) => step.label === 'whole-artifact provenance capture')?.args).toEqual([
			'scripts/artifact-provenance.ts',
			'spectra',
		]);
		expect(RELEASE_STEPS.find((step) => step.label === 'production Chrome integration')?.args).toEqual([
			'run',
			'--cwd',
			'apps/extension-spectra',
			'test:chrome:dist',
		]);
		expect(RELEASE_STEPS.find((step) => step.label === 'dependency audit')?.args).toEqual([
			'run',
			'audit:dependencies',
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
				readSourceDigest: () => 'a'.repeat(64),
				readTreeIdentity: () => fakeReleaseTreeIdentity('a'.repeat(64)),
				createCandidate: () => fakeCandidateReceipt(),
				spawnProcess(_executable: string, args: string[], options: { env?: NodeJS.ProcessEnv }) {
					invoked.push(args);
					if (args[0] === 'scripts/check-spectra-remote-live.ts') remoteEnvironment = options.env;
					return { status: args[0] === 'scripts/check-spectra-remote-live.ts' ? 1 : 0 };
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
			'scripts/check-spectra-remote-live.ts',
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
			readTreeIdentity: () => fakeReleaseTreeIdentity('a'.repeat(64)),
			createCandidate: () => fakeCandidateReceipt(),
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
			readTreeIdentity() {
				return fakeReleaseTreeIdentity(digestReadCount === 0 ? 'frozen-source' : 'changed-source');
			},
			createCandidate: () => fakeCandidateReceipt(),
			cleanupStaging() {
				cleanupCalls += 1;
			},
		})).toThrow('exact tree changed during architecture verify');
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

function temporaryCandidateReceiptDirectory(): string {
	const directory = mkdtempSync(resolve(tmpdir(), 'spectra-candidate-receipt-'));
	temporaryDirectories.push(directory);
	return directory;
}

function fakeReleaseTreeIdentity(sourceSha256: string) {
	return {
		commitOid: 'e'.repeat(40),
		treeOid: 'f'.repeat(40),
		sourceSha256,
	};
}

function fakeCandidateReceipt(): ReturnType<typeof createCandidateReceipt> {
	const directory = temporaryDirectory();
	return {
		directory,
		receiptPath: resolve(directory, 'candidate.json'),
		capability: '1'.repeat(64),
		facts: {} as ReturnType<typeof createCandidateReceipt>['facts'],
		receipt: {} as ReturnType<typeof createCandidateReceipt>['receipt'],
	};
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

function sizeReport(overrides: Partial<{
	serviceWorkerWake: number;
	documentStart: number;
	offscreenAudioOnly: number;
	offscreenRemote: number;
	javascript: number;
	total: number;
}> = {}) {
	return {
		artifactSha256: 'size-report',
		boundaryReplications: [],
		documentStart: { scriptBytes: overrides.documentStart ?? 0 },
		duplicates: [],
		entrypoints: [],
		failures: [],
		files: 0,
		javascript: overrides.javascript ?? 0,
		outputAttribution: { outputClosures: [], sharedInputs: [], status: 'not-measured' },
		offscreenAudioOnly: { scriptBytes: overrides.offscreenAudioOnly ?? 0 },
		offscreenRemote: { scriptBytes: overrides.offscreenRemote ?? 0 },
		reachable: 0,
		schemaVersion: 1,
		serviceWorkerWake: { scriptBytes: overrides.serviceWorkerWake ?? 0 },
		sizeSignals: [],
		topContributors: [],
		total: overrides.total ?? 0,
	};
}
