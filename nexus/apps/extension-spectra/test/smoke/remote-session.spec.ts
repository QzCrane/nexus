import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import { browser, eventually, installRemotePagePeerHarness, remotePairingUrl } from './harness';
import type { RemotePublicSession } from './harness';
import { prepareSmokeSession, startSmokeSession, teardownSmokeSession } from './harness';

describe('SPECTRA built extension smoke: remote-session', () => {
	beforeAll(async () => {
		const options = await prepareSmokeSession();
		const launched = await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/remote-session.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		});
		await startSmokeSession(launched);
	}, 60_000);

	afterAll(async () => {
		await teardownSmokeSession();
	});

	test('renders the authenticated Remote page and emits the exact command envelope without public signaling', async () => {
		const session: RemotePublicSession = {
			protocolVersion: 3,
			sessionId: 'C'.repeat(22),
			peerId: `spectra-${'d'.repeat(32)}`,
			secret: 'E'.repeat(22),
			createdAt: Date.now(),
			pairingExpiresAt: Date.now() + 60_000,
			tabId: 1,
			connected: false,
		};
		const rejectedPage = await browser.newPage();
		const authenticatedPage = await browser.newPage();
		try {
			await installRemotePagePeerHarness(rejectedPage, session);
			await rejectedPage.goto(remotePairingUrl(session, 'A'.repeat(22)), {
				waitUntil: 'domcontentloaded',
			});
			await rejectedPage.waitForFunction(
				() => document.querySelector('#status-text')?.textContent === 'Authentication failed',
				{ timeout: 5_000, polling: 50 },
			);
			expect(await rejectedPage.evaluate(() => location.hash)).toBe('');
			expect(await rejectedPage.$eval('#tab-title', (element) => element.textContent)).toBe(
				'Waiting for authenticated sync…',
			);
			expect(await rejectedPage.$eval('[data-command="volume_up"]', (element) => (
				(element as HTMLButtonElement).disabled
			))).toBe(true);

			await installRemotePagePeerHarness(authenticatedPage, session);
			await authenticatedPage.goto(remotePairingUrl(session), { waitUntil: 'domcontentloaded' });
			await authenticatedPage.waitForFunction(
				() => document.querySelector('#status-text')?.textContent === 'Authenticated and connected'
					&& document.querySelector('#tab-title')?.textContent === 'SPECTRA extension smoke fixture',
				{ timeout: 5_000, polling: 50 },
			);
			expect(await authenticatedPage.evaluate(() => location.hash)).toBe('');
			expect(await authenticatedPage.$eval('[data-command="volume_up"]', (element) => (
				(element as HTMLButtonElement).disabled
			))).toBe(false);
			expect(await authenticatedPage.$eval('#volume-display', (element) => (
				element.classList.contains('capture-active')
			))).toBe(true);
			expect(await authenticatedPage.$eval('#vol-display', (element) => element.textContent)).toBe('140%');

			await authenticatedPage.$eval(
				'[data-command="volume_up"]',
				(element) => (element as HTMLButtonElement).click(),
			);
			const commands = await eventually(
				() => authenticatedPage.evaluate(() => (
					(window as Window & {
						__spectraRemotePeerHarness?: { commands: Array<Record<string, unknown>> };
					}).__spectraRemotePeerHarness?.commands ?? []
				)),
				(values) => values.length > 0 ? values : undefined,
				'remote page command envelope',
				5_000,
			);
			expect(commands.at(-1)).toEqual({
				type: 'spectra.remote.command',
				protocolVersion: 3,
				sessionId: session.sessionId,
				sessionEpoch: 1,
				commandId: expect.any(String),
				sequence: 1,
				generation: 17,
				command: 'volume_up',
			});
		} finally {
			await Promise.all([rejectedPage.close(), authenticatedPage.close()]);
		}
	}, 20_000);
});
