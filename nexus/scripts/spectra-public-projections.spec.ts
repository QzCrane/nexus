import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpectraProjectionModel, checkSpectraProjectionModel, SPECTRA_NETWORK_PROVIDERS } from './spectra-public-projections.ts';

const spectraDirectory = fileURLToPath(new URL('../apps/extension-spectra/', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe('SPECTRA public ProjectionModel', () => {
	test('covers every locale, permission owner, privacy owner, and network provider', () => {
		const model = checkSpectraProjectionModel(spectraDirectory);
		expect(model.locales.map((locale) => locale.locale)).toEqual([
			'de-DE',
			'en-US',
			'es-ES',
			'fr-FR',
			'ja-JP',
			'ko-KR',
			'ru-RU',
			'zh-CN',
			'zh-TW',
		]);
		expect(model.permissionIssues).toEqual([]);
		expect(model.network.privacyProviderCoverage).toEqual([...SPECTRA_NETWORK_PROVIDERS]);
		expect(model.network.privacyJustificationProviderCoverage).toEqual([...SPECTRA_NETWORK_PROVIDERS]);
		expect(Object.values(model.network.listingProviderCoverage).every((providers) => (
			providers.length === SPECTRA_NETWORK_PROVIDERS.length
		))).toBe(true);
		expect(model.network.remoteCspValid).toBe(true);
	});

	test('reports a missing locale projection instead of silently sampling English and Chinese', () => {
		const directory = mkdtempSync(resolve(tmpdir(), 'spectra-projection-model-'));
		temporaryDirectories.push(directory);
		mkdirSync(resolve(directory, 'store-listings'), { recursive: true });
		mkdirSync(resolve(directory, 'public/_locales/en'), { recursive: true });
		writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ version: '1.0.0' }));
		writeFileSync(resolve(directory, 'public/manifest.json'), '{}');
		writeFileSync(resolve(directory, 'public/_locales/en/messages.json'), JSON.stringify({
			extName: { message: 'SPECTRA' },
			extDescription: { message: 'SPECTRA' },
		}));
		writeFileSync(resolve(directory, 'store-listings/en-US.md'), 'English projection');
		writeFileSync(resolve(directory, 'store-listings/ja-JP.md'), 'Japanese projection without messages');
		writeFileSync(resolve(directory, 'PRIVACY.md'), 'Cloudflare Pages PeerJS STUN TURN off by default does not send');
		writeFileSync(resolve(directory, 'store-listings/privacy-justifications.md'), 'Cloudflare Pages PeerJS STUN TURN off by default');
		writeFileSync(resolve(directory, 'store-listings/release-notes-1.0.0.md'), 'release');
		const remoteDirectory = resolve(directory, 'remote-site');
		mkdirSync(remoteDirectory);
		writeFileSync(resolve(remoteDirectory, 'index.html'), "script-src 'self' connect-src https://0.peerjs.com stun: turn:");

		const model = buildSpectraProjectionModel(directory, { remoteSiteDir: remoteDirectory });
		expect(model.failures).toContain('SPECTRA ja-JP: store listing has no matching _locales projection');
	});
});
