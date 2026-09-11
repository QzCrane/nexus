import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUN_VERSION } from '../../../scripts/toolchain-versions';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionDir = resolve(scriptDir, '..');
const workspaceDir = resolve(extensionDir, '../..');
const screenshotPath = resolve(
	extensionDir,
	'store-listings/assets/halo-sidepanel-1280x800.png',
);
const browserFloor = JSON.parse(
	readFileSync(resolve(workspaceDir, 'browser-floor.json'), 'utf8'),
) as { chromeForTestingVersion?: unknown };

function runStep(
	args: string[],
	label: string,
	environment: NodeJS.ProcessEnv = process.env,
): void {
	const result = spawnSync(process.execPath, args, {
		cwd: extensionDir,
		stdio: 'inherit',
		shell: false,
		env: environment,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
	}
}

function assertRuntime(): void {
	if (Bun.version !== BUN_VERSION) {
		throw new Error(`HALO store capture requires Bun ${BUN_VERSION}, found ${Bun.version}`);
	}
}

function baselineEnvironment(): NodeJS.ProcessEnv {
	const executable = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
	if (!executable || !existsSync(executable)) {
		throw new Error(
			'HALO visual baseline update requires NEXUS_CHROME_EXECUTABLE pointing at the pinned Chrome-for-Testing binary',
		);
	}
	const expected = browserFloor.chromeForTestingVersion;
	if (typeof expected !== 'string' || expected.trim().length === 0) {
		throw new Error('browser-floor.json is missing chromeForTestingVersion');
	}
	return {
		...process.env,
		NEXUS_CHROME_EXECUTABLE: executable,
		NEXUS_EXPECTED_CHROME_VERSION: expected,
		NEXUS_UPDATE_VISUAL_BASELINE: '1',
	};
}

async function assertPngDimensions(path: string, width: number, height: number): Promise<void> {
	const png = await readFile(path);
	const signature = '89504e470d0a1a0a';
	if (png.subarray(0, 8).toString('hex') !== signature) {
		throw new Error(`HALO store asset is not a PNG: ${path}`);
	}
	const actualWidth = png.readUInt32BE(16);
	const actualHeight = png.readUInt32BE(20);
	if (actualWidth !== width || actualHeight !== height) {
		throw new Error(
			`HALO store asset must be ${width}x${height}, found ${actualWidth}x${actualHeight}`,
		);
	}
}

async function capture(): Promise<void> {
	assertRuntime();
	const environment = baselineEnvironment();
	runStep(['run', 'build:prod'], 'HALO production build', environment);
	runStep(
		['x', 'playwright', 'test', 'test/store-assets.spec.ts', '--workers=1'],
		'HALO store asset browser capture',
		environment,
	);
	await assertPngDimensions(screenshotPath, 1280, 800);
	console.log(`✓ Verified pinned HALO visual baseline ${screenshotPath}`);
}

await capture();
