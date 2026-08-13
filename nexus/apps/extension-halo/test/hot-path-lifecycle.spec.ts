import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { watchWallClockDeadline } from '../src/kernel/utils/wall-clock-deadline';
import { parseClipboardSettings } from '../src/tools/clipboard/types';

function readSource(relativePath: string): string {
	return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('HALO hot-path lifecycle ownership', () => {
	test('voice-listener rebinds preserve speech while panel unmount disposes browser speech', () => {
		const panel = readSource('../src/tools/text-to-speech/panel.tsx');
		const voicesEffectStart = panel.indexOf("speechSynthesis.addEventListener('voiceschanged'");
		const voicesEffectEnd = panel.indexOf('const handleLoadSelected', voicesEffectStart);
		const voicesEffect = panel.slice(voicesEffectStart, voicesEffectEnd);

		expect(voicesEffectStart).toBeGreaterThanOrEqual(0);
		expect(voicesEffectEnd).toBeGreaterThan(voicesEffectStart);
		expect(voicesEffect).not.toContain('speechGenerationRef.current += 1');
		expect(panel).toMatch(/useEffect\(\(\) => \{\s*return \(\) => \{\s*speechGenerationRef\.current \+= 1;\s*stop\(\);\s*\};\s*\}, \[\]\);/u);
	});

	test('wall-clock deadline watcher re-arms after a backward jump and completes after a forward jump', () => {
		let clock = 1000;
		let scheduled: { callback: () => void; delayMs: number } | null = null;
		let clearCount = 0;
		const dueSamples: number[] = [];
		const checks: Array<[number, number]> = [];

		const dispose = watchWallClockDeadline(5000, {
			onCheck: (now, remainingMs) => checks.push([now, remainingMs]),
			onDue: (now) => dueSamples.push(now),
		}, {
			now: () => clock,
			schedule: (callback, delayMs) => {
				scheduled = { callback, delayMs };
				return 1 as unknown as ReturnType<typeof setTimeout>;
			},
			clear: () => { clearCount += 1; },
			maxCheckMs: 1000,
		});

		expect(checks).toEqual([[1000, 4000]]);
		expect(scheduled?.delayMs).toBe(1000);

		clock = 500;
		const afterBackwardJump = scheduled;
		afterBackwardJump?.callback();
		expect(dueSamples).toEqual([]);
		expect(checks.at(-1)).toEqual([500, 4500]);
		expect(scheduled?.delayMs).toBe(1000);

		clock = 6000;
		const afterForwardJump = scheduled;
		afterForwardJump?.callback();
		expect(dueSamples).toEqual([6000]);
		expect(checks.at(-1)).toEqual([6000, 0]);

		dispose();
		expect(clearCount).toBe(0);
	});

	test('Timer and Pomodoro use self-correcting completion checks without persistent tick writes', () => {
		const timer = readSource('../src/tools/timer/panel.tsx');
		const pomodoro = readSource('../src/tools/pomodoro/panel.tsx');

		expect(timer).toContain('watchWallClockDeadline(deadline');
		expect(timer).not.toContain('window.setTimeout');
		expect(pomodoro).toContain('window.setInterval(tick, 1000)');
		expect(pomodoro).not.toContain('window.setTimeout');
		expect(pomodoro).toContain('if (current.endsAt > observedNow) return;');
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
		expect(entry).toContain('parseClipboardSettings');
		expect(entry).toContain('updateClipboardState(false)');
		expect(entry).not.toContain('updateClipboardState(true);\n\t});');
		expect(entry).toMatch(/setTimeout\(\(\) => \{\s*if \(!listenerAttached\) return;/u);
		expect(parseClipboardSettings(undefined)).toEqual({ enabled: false });
		expect(parseClipboardSettings({ enabled: 'yes' })).toEqual({ enabled: false });
		expect(parseClipboardSettings({ enabled: true })).toEqual({ enabled: true });
	});
});
