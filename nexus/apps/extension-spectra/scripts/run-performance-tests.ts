import { spawnSync } from 'node:child_process';

const tests = [
	'test/performance.spec.ts',
	'test/popup-inventory-latency.spec.ts',
	'test/runtime-stress-performance.spec.ts',
	'test/service-worker-wake-performance.spec.ts',
	'test/runtime-long-session-performance.spec.ts',
];

for (const test of tests) {
	const result = spawnSync(process.execPath, ['test', test], {
		env: { ...process.env, SPECTRA_CHROME_INTEGRATION: '1' },
		shell: false,
		stdio: 'inherit',
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		if (result.signal) throw new Error(`Chrome performance test runner terminated by ${result.signal}`);
		process.exitCode = result.status ?? 1;
		break;
	}
}
