import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isWebsiteClaimedHotkeyEvent } from '../src/content/input/hotkey-event';

describe('website-first hotkey fallback', () => {
	test('uses final browser event ownership flags instead of treating a missed tail as claimed', () => {
		expect(isWebsiteClaimedHotkeyEvent({ defaultPrevented: false, cancelBubble: false })).toBe(false);
		expect(isWebsiteClaimedHotkeyEvent({ defaultPrevented: true, cancelBubble: false })).toBe(true);
		expect(isWebsiteClaimedHotkeyEvent({ defaultPrevented: false, cancelBubble: true })).toBe(true);
		expect(isWebsiteClaimedHotkeyEvent({ defaultPrevented: true, cancelBubble: true })).toBe(true);

		const source = readFileSync(
			resolve(import.meta.dir, '../src/content/input/hotkey-event.ts'),
			'utf8',
		);
		const fallbackStart = source.indexOf('const cleanupTimer = setTimeout');
		const fallbackEnd = source.indexOf('pending.set(event', fallbackStart);
		const fallback = source.slice(fallbackStart, fallbackEnd);
		expect(fallbackStart).toBeGreaterThanOrEqual(0);
		expect(fallbackEnd).toBeGreaterThan(fallbackStart);
		expect(fallback).toContain('const websiteClaimed = isWebsiteClaimedHotkeyEvent(event)');
		expect(fallback).toContain('options.onSettled(event, owned.candidate, true)');
		expect(fallback).toContain('options.onSettled(event, owned.candidate, false)');
	});
});
