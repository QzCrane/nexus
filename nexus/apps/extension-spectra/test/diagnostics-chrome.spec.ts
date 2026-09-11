import { launchBrowser } from './helpers/browser-driver';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Browser, Page, Target } from 'puppeteer';

const EXTENSION_DIR = resolve(process.env.SPECTRA_EXTENSION_DIR ?? join(import.meta.dir, '..', 'dist'));
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
const EXPECTED_CHROME = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
if (!existsSync(join(EXTENSION_DIR, 'manifest.json'))) {
	throw new Error(`SPECTRA extension directory is missing manifest.json: ${EXTENSION_DIR}`);
}
if (EXPLICIT_CHROME && !existsSync(EXPLICIT_CHROME)) {
	throw new Error(`Pinned Chrome executable is missing: ${EXPLICIT_CHROME}`);
}

let browser: Browser;
let profileDir = '';
let extensionId = '';
let privatePage: Page;
let server: ReturnType<typeof Bun.serve>;
let privateUrl = '';

beforeAll(async () => {
	server = Bun.serve({
		port: 0,
		hostname: '127.0.0.1',
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname !== '/private-diagnostic-fixture') return new Response('not found', { status: 404 });
			return new Response(
				'<!doctype html><html><head><title>PRIVATE_DIAGNOSTIC_TITLE</title></head><body>PRIVATE_DIAGNOSTIC_BODY</body></html>',
				{ headers: { 'content-type': 'text/html; charset=utf-8' } },
			);
		},
	});
	privateUrl = `http://127.0.0.1:${server.port}/private-diagnostic-fixture?token=PRIVATE_TOKEN_987654`;
	profileDir = await mkdtemp(join(tmpdir(), 'spectra-diagnostics-'));
	browser = await launchBrowser({
		...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : {}),
		headless: true,
		userDataDir: profileDir,
		args: [
			`--disable-extensions-except=${EXTENSION_DIR}`,
			`--load-extension=${EXTENSION_DIR}`,
			'--no-sandbox',
			'--disable-setuid-sandbox',
		],
	});
	if (EXPECTED_CHROME) expect(await browser.version()).toContain(EXPECTED_CHROME);
	const workerTarget: Target = await browser.waitForTarget(
		(target) => target.type() === 'service_worker'
			&& /^chrome-extension:\/\/[^/]+\/background\.js$/u.test(target.url()),
		{ timeout: 30_000 },
	);
	extensionId = new URL(workerTarget.url()).host;
	privatePage = await browser.newPage();
	await privatePage.goto(privateUrl, { waitUntil: 'domcontentloaded' });
}, 60_000);

afterAll(async () => {
	await browser?.close().catch(() => undefined);
	if (profileDir) {
		await rm(profileDir, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 100,
		});
	}
	server?.stop(true);
});

describe('SPECTRA local diagnostic export privacy', () => {
	test('exports useful browser and owner facts without tab URL/title/token content', async () => {
		const options = await browser.newPage();
		try {
			await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' });
			await options.waitForSelector('#diagnostics-export-btn', { timeout: 10_000 });
			await options.evaluate(() => {
				const scope = window as Window & { __spectraDiagnosticJson?: string };
				URL.createObjectURL = ((blob: Blob) => {
					void blob.text().then((text) => { scope.__spectraDiagnosticJson = text; });
					return 'blob:diagnostic-test';
				}) as typeof URL.createObjectURL;
				HTMLAnchorElement.prototype.click = function click(): void {
					// Test-only: capture the Blob above without navigating/downloading.
				};
			});
			await options.click('#diagnostics-export-btn');
			await options.waitForFunction(
				() => typeof (window as Window & { __spectraDiagnosticJson?: string }).__spectraDiagnosticJson === 'string',
				{ timeout: 10_000 },
			);
			const json = await options.evaluate(() => (
				(window as Window & { __spectraDiagnosticJson?: string }).__spectraDiagnosticJson ?? ''
			));
			const bundle = JSON.parse(json) as {
				product?: string;
				manifestVersion?: string;
				browser?: { major?: number | null };
				permissions?: string[];
				origins?: { grantCount?: number; broadGrant?: boolean };
				contexts?: Record<string, number>;
				owners?: Record<string, boolean | number | null>;
			};
			expect(bundle.product).toBe('SPECTRA');
			expect(bundle.manifestVersion).toMatch(/^\d+\.\d+\.\d+$/u);
			expect(typeof bundle.browser?.major === 'number' || bundle.browser?.major === null).toBe(true);
			expect(Array.isArray(bundle.permissions)).toBe(true);
			expect(typeof bundle.origins?.grantCount).toBe('number');
			expect(typeof bundle.origins?.broadGrant).toBe('boolean');
			expect(Object.keys(bundle.contexts ?? {}).length).toBeGreaterThan(0);

			const owners = bundle.owners ?? {};
			for (const key of [
				'backgroundSurfaceActive',
				'audibleTabCount',
				'userScriptsPermissionGranted',
				'captureStateCount',
				'activeCaptureCount',
				'badgeStateCount',
				'mediaTabStateCount',
				'offscreenLeaseCount',
				'offscreenHostStateUnknown',
				'offscreenReadSucceeded',
				'offscreenHostPresent',
				'offscreenAudioProcessorCount',
				'offscreenRemoteSessionCount',
			]) {
				expect(Object.hasOwn(owners, key)).toBe(true);
				const value = owners[key];
				expect(value === null || typeof value === 'boolean' || typeof value === 'number').toBe(true);
			}

			expect(json).not.toContain('PRIVATE_DIAGNOSTIC_TITLE');
			expect(json).not.toContain('PRIVATE_DIAGNOSTIC_BODY');
			expect(json).not.toContain('PRIVATE_TOKEN_987654');
			expect(json).not.toContain(privateUrl);
			expect(json).not.toContain('127.0.0.1');
		} finally {
			await options.close();
		}
	}, 30_000);
});
