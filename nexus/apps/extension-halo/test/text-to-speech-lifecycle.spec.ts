import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('Text-to-Speech lifecycle ownership', () => {
	test('voice-listener rebinds do not retire the active utterance generation', () => {
		const panel = readFileSync(
			new URL('../src/tools/text-to-speech/panel.tsx', import.meta.url),
			'utf8',
		);
		const voicesEffectStart = panel.indexOf("speechSynthesis.addEventListener('voiceschanged'");
		const voicesEffectEnd = panel.indexOf('const handleLoadSelected', voicesEffectStart);
		const voicesEffect = panel.slice(voicesEffectStart, voicesEffectEnd);

		expect(voicesEffectStart).toBeGreaterThanOrEqual(0);
		expect(voicesEffectEnd).toBeGreaterThan(voicesEffectStart);
		expect(voicesEffect).not.toContain('speechGenerationRef.current += 1');
		expect(panel).toMatch(/useEffect\(\(\) => \{\s*return \(\) => \{\s*speechGenerationRef\.current \+= 1;\s*\};\s*\}, \[\]\);/u);
	});
});
