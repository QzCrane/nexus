import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function readSource(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('HALO hot-path lifecycle ownership', () => {
	test('voice-listener rebinds do not retire the active utterance generation', () => {
		const panel = readSource('../src/tools/text-to-speech/panel.tsx');
		const voicesEffectStart = panel.indexOf("speechSynthesis.addEventListener('voiceschanged'");
		const voicesEffectEnd = panel.indexOf('const handleLoadSelected', voicesEffectStart);
		const voicesEffect = panel.slice(voicesEffectStart, voicesEffectEnd);

		expect(voicesEffectStart).toBeGreaterThanOrEqual(0);
		expect(voicesEffectEnd).toBeGreaterThan(voicesEffectStart);
		expect(voicesEffect).not.toContain('speechGenerationRef.current += 1');
		expect(panel).toMatch(/useEffect\(\(\) => \{\s*return \(\) => \{\s*speechGenerationRef\.current \+= 1;\s*\};\s*\}, \[\]\);/u);
	});

	test('TOTP caches by counter without unbounded per-account crypto fan-out', () => {
		const panel = readSource('../src/tools/totp/panel.tsx');

		expect(panel).toContain('cached.counter !== counter');
		expect(panel).toContain('for (const entry of entries)');
		expect(panel).not.toMatch(/Promise\.all\s*\(\s*entries\.map/u);
	});

	test('clipboard storage events outrank delayed hydration and disable revokes pending capture', () => {
		const entry = readSource('../src/entry/content-clipboard.ts');
		const listenerIndex = entry.indexOf('chrome.storage.onChanged.addListener');
		const initialReadIndex = entry.indexOf('chrome.storage.local.get');

		expect(listenerIndex).toBeGreaterThanOrEqual(0);
		expect(initialReadIndex).toBeGreaterThan(listenerIndex);
		expect(entry).toContain('settingsEventObserved = true');
		expect(entry).toContain('if (settingsEventObserved) return;');
		expect(entry).toMatch(/setTimeout\(\(\) => \{\s*if \(!listenerAttached\) return;/u);
	});
});
