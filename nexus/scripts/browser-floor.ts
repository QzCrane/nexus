// goal: own the declared minimum Chrome version and exact replay browser in one machine-readable source
// inv: both products declare the same major and the replay artifact is exact-version + SHA-256 bound

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const floorPath = resolve(workspaceDir, 'browser-floor.json');

export interface BrowserFloor {
	schemaVersion: 1;
	minimumChromeMajor: number;
	chromeForTestingVersion: string;
	linux64: {
		url: string;
		sha256: string;
		executable: string;
	};
	evidence: {
		channel: 'stable';
		platform: 'linux64';
		purpose: string;
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseBrowserFloor(value: unknown): BrowserFloor {
	if (!isRecord(value)
		|| value.schemaVersion !== 1
		|| !Number.isInteger(value.minimumChromeMajor)
		|| Number(value.minimumChromeMajor) < 100
		|| typeof value.chromeForTestingVersion !== 'string'
		|| !/^\d+\.\d+\.\d+\.\d+$/u.test(value.chromeForTestingVersion)
		|| !isRecord(value.linux64)
		|| typeof value.linux64.url !== 'string'
		|| typeof value.linux64.sha256 !== 'string'
		|| !/^[0-9a-f]{64}$/u.test(value.linux64.sha256)
		|| typeof value.linux64.executable !== 'string'
		|| !isRecord(value.evidence)
		|| value.evidence.channel !== 'stable'
		|| value.evidence.platform !== 'linux64'
		|| typeof value.evidence.purpose !== 'string'
		|| value.evidence.purpose.trim().length === 0) {
		throw new Error('browser-floor.json is malformed');
	}
	const major = Number(value.chromeForTestingVersion.split('.')[0]);
	if (major !== value.minimumChromeMajor) {
		throw new Error(
			`Chrome floor major ${value.minimumChromeMajor} disagrees with replay ${value.chromeForTestingVersion}`,
		);
	}
	const expectedUrl = `https://storage.googleapis.com/chrome-for-testing-public/${value.chromeForTestingVersion}/linux64/chrome-linux64.zip`;
	if (value.linux64.url !== expectedUrl) {
		throw new Error(`Chrome floor URL must be exact Chrome for Testing linux64 URL: ${expectedUrl}`);
	}
	if (value.linux64.executable !== 'chrome-linux64/chrome') {
		throw new Error('Chrome floor linux64 executable must be chrome-linux64/chrome');
	}
	return value as unknown as BrowserFloor;
}

export function readBrowserFloor(): BrowserFloor {
	return parseBrowserFloor(JSON.parse(readFileSync(floorPath, 'utf8')));
}

function readManifestMinimum(relativePath: string): string {
	const manifest = JSON.parse(readFileSync(resolve(workspaceDir, relativePath), 'utf8')) as unknown;
	if (!isRecord(manifest) || typeof manifest.minimum_chrome_version !== 'string') {
		throw new Error(`${relativePath}: minimum_chrome_version is missing`);
	}
	return manifest.minimum_chrome_version;
}

export function validateProductMinimums(
	floor: BrowserFloor,
	minimums: Readonly<Record<string, string>>,
): string[] {
	const expected = String(floor.minimumChromeMajor);
	return Object.entries(minimums).flatMap(([owner, minimum]) => (
		minimum === expected ? [] : [`${owner}: expected minimum Chrome ${expected}, got ${minimum}`]
	));
}

export function checkBrowserFloor(): void {
	const floor = readBrowserFloor();
	const minimums = {
		HALO: readManifestMinimum('apps/extension-halo/public/manifest.json'),
		SPECTRA: readManifestMinimum('apps/extension-spectra/public/manifest.json'),
	};
	const errors = validateProductMinimums(floor, minimums);
	if (errors.length > 0) throw new Error(`Browser floor drift:\n- ${errors.join('\n- ')}`);
	console.log(
		`✓ Browser floor: Chrome ${floor.minimumChromeMajor}, replay ${floor.chromeForTestingVersion} (${floor.evidence.platform})`,
	);
}

export function githubEnvironmentLines(floor: BrowserFloor): string[] {
	return [
		`CHROME_FLOOR_VERSION=${floor.chromeForTestingVersion}`,
		`CHROME_FLOOR_URL=${floor.linux64.url}`,
		`CHROME_FLOOR_SHA256=${floor.linux64.sha256}`,
		`CHROME_FLOOR_EXECUTABLE=${floor.linux64.executable}`,
		`NEXUS_EXPECTED_CHROME_VERSION=${floor.chromeForTestingVersion}`,
	];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const mode = process.argv[2] ?? 'check';
	const floor = readBrowserFloor();
	if (mode === 'check') checkBrowserFloor();
	else if (mode === 'github-env') console.log(githubEnvironmentLines(floor).join('\n'));
	else throw new Error(`Unknown browser-floor mode: ${mode}`);
}
