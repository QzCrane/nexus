import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	browserEvidenceContext,
	browserExecutableEvidence,
	collectBrowserLaunchEvidence,
	collectDefaultReleaseBrowserOwners,
	inspectBrowserEntrySource,
	normalizedBrowserLaunches,
	profileCommandLineEvidence,
	sanitizeBrowserArgument,
	sanitizeBrowserArguments,
	assertExpectedBrowserVersion,
	writeBrowserLaunchEvidence,
	type BrowserLaunchIdentity,
} from './browser-driver';

const temporary: string[] = [];

afterEach(() => {
	for (const path of temporary.splice(0)) rmSync(path, { force: true, recursive: true, maxRetries: 3, retryDelay: 100 });
});

function launchInput(): Omit<
	BrowserLaunchIdentity,
	'head' | 'tree' | 'run' | 'attempt' | 'executionSequence'
> {
	return {
		schemaVersion: 1,
		owner: 'apps/extension-halo/test/example-playwright.spec.ts',
		driver: 'playwright',
		platform: process.platform,
		arch: process.arch,
		browserVersion: 'Chrome/152.0.0.0',
		executable: {
			status: 'observed',
			basename: 'chrome.exe',
			bytes: 42,
			informationalSha256: 'a'.repeat(64),
		},
		effectiveArgs: ['--headless'],
		profile: {
			kind: 'temporary',
			prefix: 'halo-example-',
			isolated: true,
			commandLine: { status: 'matched' },
		},
	};
}

describe('actual browser launch evidence owner', () => {
	test('collects browser owners from the maintained default product scripts', () => {
		const owners = collectDefaultReleaseBrowserOwners();
		expect(owners).toContain('apps/extension-halo/test/sidepanel-performance.spec.ts');
		expect(owners).toContain('apps/extension-halo/test/smooth-scroll-keyboard-playwright.spec.ts');
		expect(owners).toContain('apps/extension-spectra/test/smoke/capture.spec.ts');
		expect(owners).toContain('apps/extension-spectra/test/smoke/feedback.spec.ts');
		expect(owners).toContain('apps/extension-spectra/test/smoke/hotkeys.spec.ts');
		expect(owners).toContain('apps/extension-spectra/test/smoke/page-media.spec.ts');
		expect(owners).toContain('apps/extension-spectra/test/smoke/popup-ui.spec.ts');
		expect(owners).toContain('apps/extension-spectra/test/smoke/remote-session.spec.ts');
		expect(owners).toContain('apps/extension-spectra/test/smoke/runtime-bootstrap.spec.ts');
		expect(owners).toContain('apps/extension-spectra/test/smoke/visualizer.spec.ts');
		expect(owners).not.toContain('apps/extension-spectra/test/service-worker-wake-performance.spec.ts');
		expect(owners).not.toContain('apps/extension-halo/test/extension-worker.spec.ts');
		expect(owners).toHaveLength(15);
	});

	test('keeps requested profile paths out of effective launch evidence', () => {
		expect(sanitizeBrowserArgument('--user-data-dir=C:/Users/private/profile')).toBe(
			'--user-data-dir=<temporary-profile>',
		);
		expect(sanitizeBrowserArgument('--load-extension=D:/Project/Nexus/nexus/apps/extension-halo/dist'))
			.toBe('--load-extension=apps/extension-halo/dist');
		expect(sanitizeBrowserArguments(['--user-data-dir', 'C:/Users/private/random-profile', '--headless']))
			.toEqual(['--user-data-dir=<temporary-profile>', '--headless']);
	});

	test('marks a missing browser-returned executable as unknown instead of using an override', () => {
		expect(browserExecutableEvidence(undefined)).toEqual({
			status: 'unknown',
			reason: 'browser-command-line-omitted-executable',
		});
		expect(browserExecutableEvidence(process.execPath)).toMatchObject({
			status: 'observed',
			basename: process.platform === 'win32' ? 'bun.exe' : 'bun',
		});
	});

	test('revalidates executable stat identity before reusing a cached digest', () => {
		const directory = mkdtempSync(join(tmpdir(), 'nexus-browser-binary-'));
		temporary.push(directory);
		const executable = join(directory, 'chrome-fixture.exe');
		writeFileSync(executable, 'first');
		const first = browserExecutableEvidence(executable);
		writeFileSync(executable, 'second-version');
		const second = browserExecutableEvidence(executable);
		expect(first).not.toEqual(second);
	});

	test('requires exact version tails and exact profile command-line readback', () => {
		expect(() => assertExpectedBrowserVersion('Chrome/152.0.0.0', '52.0.0.0')).toThrow(
			'Browser replay version mismatch',
		);
		expect(profileCommandLineEvidence(
			['--user-data-dir', 'C:/Temp/profile'],
			'C:/Temp/profile',
		)).toEqual({ status: 'matched' });
		expect(() => profileCommandLineEvidence(
			['--user-data-dir=C:/Temp/other'],
			'C:/Temp/profile',
		)).toThrow('different profile');
	});

	test('rejects direct browser launches and mismatched recorded owners in default entries', () => {
		expect(() => inspectBrowserEntrySource(
			"import { chromium as chrome } from '@playwright/test'; chrome.launchPersistentContext('p', {});",
			'direct.spec.ts',
			'apps/extension-halo/test/direct.spec.ts',
		)).toThrow('direct browser launch');
		expect(() => inspectBrowserEntrySource(
			"import browser from 'puppeteer'; browser.launch({});",
			'direct-puppeteer.spec.ts',
			'apps/extension-spectra/test/direct-puppeteer.spec.ts',
		)).toThrow('direct browser launch');
		expect(() => inspectBrowserEntrySource(
			"import { chromium } from '@playwright/test'; const start = chromium.launchPersistentContext; start('p', {});",
			'aliased-direct.spec.ts',
			'apps/extension-halo/test/aliased-direct.spec.ts',
		)).toThrow('direct browser launch');
		expect(() => inspectBrowserEntrySource(
			"import { launchPuppeteerBrowser as launch } from '../../../scripts/browser-driver'; launch({}, { owner: 'apps/extension-spectra/test/other.spec.ts', profile: {} });",
			'wrong.spec.ts',
			'apps/extension-spectra/test/wrong.spec.ts',
		)).toThrow('exact importing source path');
		expect(inspectBrowserEntrySource(
			"import { launchPuppeteerBrowser as launch } from '../../../scripts/browser-driver'; launch({}, { owner: 'apps/extension-spectra/test/right.spec.ts', profile: {} });",
			'right.spec.ts',
			'apps/extension-spectra/test/right.spec.ts',
		)).toBe('apps/extension-spectra/test/right.spec.ts');
	});

	test('rejects missing owners, malformed nested evidence, and incomplete physical sequences', () => {
		const outputDir = mkdtempSync(join(tmpdir(), 'nexus-browser-collector-'));
		temporary.push(outputDir);
		const context = browserEvidenceContext({
			NEXUS_BROWSER_EVIDENCE_HEAD: '3'.repeat(40),
			NEXUS_BROWSER_EVIDENCE_TREE: '4'.repeat(40),
			NEXUS_BROWSER_EVIDENCE_RUN: 'collector-negative',
			NEXUS_BROWSER_EVIDENCE_ATTEMPT: '1',
			NEXUS_BROWSER_EVIDENCE_OUTPUT_DIR: outputDir,
		});
		if (!context) throw new Error('expected collector evidence context');
		writeBrowserLaunchEvidence(context, launchInput());
		expect(() => collectBrowserLaunchEvidence(outputDir, {
			head: context.head,
			tree: context.tree,
			run: context.run,
			attempt: context.attempt,
			requiredOwners: ['apps/extension-spectra/test/missing.spec.ts'],
		})).toThrow('owner coverage mismatch');
		const [file] = readdirSync(outputDir);
		if (!file) throw new Error('expected written browser evidence');
		const path = join(outputDir, file);
		const malformed = JSON.parse(readFileSync(path, 'utf8'));
		malformed.profile.temporaryPath = 'C:/private/profile';
		writeFileSync(path, `${JSON.stringify(malformed)}\n`);
		expect(() => collectBrowserLaunchEvidence(outputDir, {
			head: context.head,
			tree: context.tree,
			run: context.run,
			attempt: context.attempt,
			requiredOwners: [launchInput().owner],
		})).toThrow('profile evidence is malformed');
		delete malformed.profile.temporaryPath;
		malformed.executionSequence = 2;
		const sequenceTwoPath = path.replace(/\.1\.json$/u, '.2.json');
		renameSync(path, sequenceTwoPath);
		writeFileSync(sequenceTwoPath, `${JSON.stringify(malformed)}\n`);
		expect(() => collectBrowserLaunchEvidence(outputDir, {
			head: context.head,
			tree: context.tree,
			run: context.run,
			attempt: context.attempt,
			requiredOwners: [launchInput().owner],
		})).toThrow('physical sequence is incomplete');
	});

	test('requires exact formal context and allocates stable repeated-owner sequences', () => {
		expect(() => browserEvidenceContext({ NEXUS_BROWSER_EVIDENCE_REQUIRED: '1' })).toThrow(
			'formal browser launch evidence context is incomplete',
		);
		const outputDir = mkdtempSync(join(tmpdir(), 'nexus-browser-evidence-'));
		temporary.push(outputDir);
		const context = browserEvidenceContext({
			NEXUS_BROWSER_EVIDENCE_REQUIRED: '1',
			NEXUS_BROWSER_EVIDENCE_HEAD: '1'.repeat(40),
			NEXUS_BROWSER_EVIDENCE_TREE: '2'.repeat(40),
			NEXUS_BROWSER_EVIDENCE_RUN: 'release:halo',
			NEXUS_BROWSER_EVIDENCE_ATTEMPT: '2',
			NEXUS_BROWSER_EVIDENCE_OUTPUT_DIR: outputDir,
		});
		if (!context) throw new Error('expected formal browser evidence context');
		writeBrowserLaunchEvidence(context, launchInput());
		writeBrowserLaunchEvidence(context, launchInput());
		const files = readdirSync(outputDir).sort();
		expect(files).toHaveLength(2);
		const records = files.map((file) => JSON.parse(readFileSync(join(outputDir, file), 'utf8')));
		expect(records.map((record) => record.executionSequence)).toEqual([1, 2]);
		expect(records.map((record) => record.profile)).toEqual([
			{ kind: 'temporary', prefix: 'halo-example-', isolated: true, commandLine: { status: 'matched' } },
			{ kind: 'temporary', prefix: 'halo-example-', isolated: true, commandLine: { status: 'matched' } },
		]);
		const collected = collectBrowserLaunchEvidence(outputDir, {
			head: '1'.repeat(40),
			tree: '2'.repeat(40),
			run: 'release:halo',
			attempt: 2,
			requiredOwners: ['apps/extension-halo/test/example-playwright.spec.ts'],
		});
		expect(collected).toHaveLength(2);
		const normalized = normalizedBrowserLaunches(collected);
		expect(normalized).toHaveLength(2);
		expect(normalized[0]).not.toHaveProperty('run');
		expect(normalized[0]).not.toHaveProperty('attempt');
		expect(normalized[0]).not.toHaveProperty('executionSequence');
		expect(() => writeBrowserLaunchEvidence(context, {
			...launchInput(),
			executable: { status: 'unknown', reason: 'missing' },
		})).toThrow('requires executable, arguments, and profile readback');
	});
});
