import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUN_VERSION } from '../../../scripts/toolchain-versions';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const extensionDir = resolve(scriptDir, '..');
const workspaceDir = resolve(extensionDir, '../..');
const browserFloor = JSON.parse(
	readFileSync(resolve(workspaceDir, 'browser-floor.json'), 'utf8'),
) as { chromeForTestingVersion?: unknown };

function baselineEnvironment(): NodeJS.ProcessEnv {
	if (Bun.version !== BUN_VERSION) {
		throw new Error(`SPECTRA visual baseline requires Bun ${BUN_VERSION}, found ${Bun.version}`);
	}
	const executable = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
	if (!executable || !existsSync(executable)) {
		throw new Error(
			'SPECTRA visual baseline update requires NEXUS_CHROME_EXECUTABLE pointing at the pinned Chrome-for-Testing binary',
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

function run(args: string[], label: string, env: NodeJS.ProcessEnv): void {
	const result = spawnSync(process.execPath, args, {
		cwd: extensionDir,
		stdio: 'inherit',
		shell: false,
		env,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
	}
}

const environment = baselineEnvironment();
run(['run', 'build:prod'], 'SPECTRA production build', environment);
run(['test', 'test/visual-baseline.spec.ts'], 'SPECTRA pinned visual baseline capture', environment);
