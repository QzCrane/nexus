import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('content runtime readiness boundary', () => {
	test('publishes READY after control listeners but before asynchronous state restoration', () => {
		const source = readFileSync(
			resolve(import.meta.dir, '../src/content/core/index.ts'),
			'utf8',
		);
		const lifecycle = source.indexOf('bootstrapLifecycle(');
		const ready = source.indexOf('setContentRuntimeReady(runtime.revision);', lifecycle);
		const restore = source.indexOf('await applyInitialState(', lifecycle);

		expect(lifecycle).toBeGreaterThan(-1);
		expect(ready).toBeGreaterThan(lifecycle);
		expect(restore).toBeGreaterThan(ready);
	});
});
