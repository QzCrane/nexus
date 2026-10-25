import { describe, expect, test } from 'bun:test';
import { isPairingWindowExpired } from '../src/remote/pairing-window';

const NOW = 1_700_000_000_000;

describe('pairing window', () => {
	test('expires an unpaired session once its window closes', () => {
		expect(isPairingWindowExpired({ connected: false, pairingExpiresAt: NOW - 1 }, NOW)).toBe(true);
	});

	test('treats the exact deadline as closed, not as still open', () => {
		expect(isPairingWindowExpired({ connected: false, pairingExpiresAt: NOW }, NOW)).toBe(true);
	});

	test('keeps an unpaired session alive while the window is still open', () => {
		expect(isPairingWindowExpired({ connected: false, pairingExpiresAt: NOW + 1 }, NOW)).toBe(false);
	});

	test('never expires an authenticated session, because the window is not a lifetime', () => {
		expect(isPairingWindowExpired({ connected: true, pairingExpiresAt: NOW - 60_000 }, NOW)).toBe(false);
	});
});
