import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('content runtime readiness boundary', () => {
	test('publishes READY only after authoritative initial hydration or application', () => {
		const source = readFileSync(
			resolve(import.meta.dir, '../src/content/core/index.ts'),
			'utf8',
		);
		const lifecycle = source.indexOf('bootstrapLifecycle(');
		const ready = source.indexOf('setContentRuntimeReady(runtime.revision);', lifecycle);
		const restore = source.indexOf('await applyInitialState(', lifecycle);
		const captureHydration = source.indexOf('if (shouldApplyInitialPolicy(state, source))', lifecycle);
		const presentation = source.indexOf('void settingsManager.load()', ready);
		const audioPolicyReads = source.match(/sendSpectraRequest\('spectra\.audio\.policy\.get'/gu) ?? [];
		const stableConfigFallbacks = source.match(/sendSpectraRequest\('spectra\.audio\.config\.get'/gu) ?? [];

		expect(lifecycle).toBeGreaterThan(-1);
		expect(restore).toBeGreaterThan(lifecycle);
		expect(captureHydration).toBeGreaterThan(lifecycle);
		expect(captureHydration).toBeLessThan(ready);
		expect(ready).toBeGreaterThan(restore);
		expect(presentation).toBeGreaterThan(ready);
		expect(audioPolicyReads).toHaveLength(1);
		expect(stableConfigFallbacks).toHaveLength(1);
	});
});
