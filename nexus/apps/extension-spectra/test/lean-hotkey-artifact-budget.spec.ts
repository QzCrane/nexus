import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	checkLeanSiteHotkeyArtifact,
	LEAN_SITE_HOTKEY_ARTIFACT,
	LEAN_SITE_HOTKEY_MAX_BYTES,
} from '../scripts/check-lean-hotkey-artifact';

const directories: string[] = [];

async function temporaryDist(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'spectra-lean-host-'));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => (
		rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
	)));
});

describe('lean site-hotkey production artifact budget', () => {
	test('accepts a self-contained artifact at the exact ceiling', async () => {
		const dist = await temporaryDist();
		await writeFile(join(dist, LEAN_SITE_HOTKEY_ARTIFACT), 'x'.repeat(LEAN_SITE_HOTKEY_MAX_BYTES));
		expect(checkLeanSiteHotkeyArtifact(dist)).toEqual({ bytes: LEAN_SITE_HOTKEY_MAX_BYTES });
	});

	test('rejects one byte beyond the physical closure ceiling', async () => {
		const dist = await temporaryDist();
		await writeFile(
			join(dist, LEAN_SITE_HOTKEY_ARTIFACT),
			'x'.repeat(LEAN_SITE_HOTKEY_MAX_BYTES + 1),
		);
		expect(() => checkLeanSiteHotkeyArtifact(dist)).toThrow('exceeds');
	});

	test('rejects a production source-map reference even below the byte ceiling', async () => {
		const dist = await temporaryDist();
		await writeFile(
			join(dist, LEAN_SITE_HOTKEY_ARTIFACT),
			'console.log(1);\n//# sourceMappingURL=content-site-hotkeys.js.map',
		);
		expect(() => checkLeanSiteHotkeyArtifact(dist)).toThrow('source-map reference is forbidden');
	});
});
