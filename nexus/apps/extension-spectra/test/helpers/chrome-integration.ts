// Shared guard for browser-provisioned integration and performance specs.
//
// These specs launch a real Chrome instance against a built extension and assert
// end-to-end behavior (real Action Popup, media-tab inventory, latency). They are
// intentionally excluded from the default `test:unit` matrix (see
// scripts/run-tests.ts) and must only run where a built extension and an
// interactive Chrome are actually provisioned. Without that signal they skip, so
// a bare `bun test` over the directory stays green instead of failing on
// environment-specific assertions or burning five minutes on a perf timeout.
//
// The provisioning signal is `SPECTRA_CHROME_INTEGRATION=1`, set by the
// `test:performance` runner when Chrome-backed performance evidence is requested.
import { afterAll, beforeAll, describe, test } from 'bun:test';

export const chromeIntegrationEnabled = process.env.SPECTRA_CHROME_INTEGRATION === '1';

export const describeChrome = chromeIntegrationEnabled ? describe : describe.skip;
export const testChrome = chromeIntegrationEnabled ? test : test.skip;

type ChromeHook = () => void | Promise<void>;

export function beforeAllChrome(callback: ChromeHook, timeout?: number): void {
	if (chromeIntegrationEnabled) beforeAll(callback, timeout);
}

export function afterAllChrome(callback: ChromeHook, timeout?: number): void {
	if (chromeIntegrationEnabled) afterAll(callback, timeout);
}
