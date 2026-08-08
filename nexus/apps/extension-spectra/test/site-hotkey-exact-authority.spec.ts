import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const hostSource = readFileSync(
	new URL('../src/content/input/lean-site-hotkey-host.ts', import.meta.url),
	'utf8',
);
const bootstrapContractSource = readFileSync(
	new URL('../../../packages/contracts/src/spectra.bootstrap.ts', import.meta.url),
	'utf8',
);

describe('lean site-hotkey exact-document authority', () => {
	test('accepts only the validated exact configure stream as configuration authority', () => {
		expect(hostSource).toContain('isSpectraLeanSiteHotkeyConfigureMessage(message)');
		expect(hostSource).toContain('message.payload.epoch');
		expect(hostSource).toContain('message.payload.generation');
		expect(hostSource).toContain('message.payload.bindings');
		expect(hostSource).not.toContain("candidate.type === 'spectra.hotkeys.changed'");
		expect(hostSource).not.toContain('isHotkeysChangedSignal');
	});

	test('uses epoch plus monotonic generation so a restarted worker can re-establish authority', () => {
		expect(hostSource).toContain('configurationEpoch === epoch && generation <= configurationGeneration');
		expect(hostSource).toContain('if (configurationEpoch !== epoch)');
		expect(hostSource).toContain('configurationGeneration = -1');
		expect(bootstrapContractSource).toContain('epoch: string;');
		expect(bootstrapContractSource).toContain("type: 'spectra.content.site-hotkeys.configure'");
	});

	test('an empty exact projection is sufficient to suspend all lean ownership', () => {
		expect(hostSource).toContain('releaseAll();');
		expect(hostSource).toContain('bindingByChord = new Map(bindings.map');
		expect(hostSource).toContain('syncArbiter();');
	});
});
