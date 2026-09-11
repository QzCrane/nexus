import type { Browser, LaunchOptions } from 'puppeteer';
import { browserReplayPolicy } from '../../../../scripts/browser-replay';

type ReplayOptions = Pick<LaunchOptions, 'executablePath' | 'headless' | 'userDataDir' | 'defaultViewport' | 'args'>;

export async function launchBrowser(options: ReplayOptions): Promise<Browser> {
	const expected = process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim();
	const policy = browserReplayPolicy(expected, options.executablePath, process.platform);
	const rootArgs = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
	// Both supported drivers disable extensions by default. An explicit extension
	// fixture must not launch with contradictory enable/disable flags.
	const extensionFixture = options.args?.some((argument) => argument.startsWith('--load-extension='));
	const launchOptions = { ...options, ...(extensionFixture ? { ignoreDefaultArgs: ['--disable-extensions'] } : {}), args: [...new Set([...(options.args ?? []), ...policy.args, ...rootArgs])] };
	// Chrome 135 and current Chrome need different CDP drivers. The nominal
	// class types differ, but this boundary uses only their shared public API;
	// the same installed-extension tests exercise both implementations.
	const browser = policy.driver === 'floor'
		? await (await import('puppeteer-floor')).default.launch(launchOptions) as unknown as Browser
		: await (await import('puppeteer')).default.launch(launchOptions);
	try {
		if (expected && (await browser.version()).split('/').pop() !== expected) {
			throw new Error(`Browser replay version mismatch: expected ${expected}, got ${await browser.version()}`);
		}
		return browser;
	} catch (error) {
		try {
			await browser.close();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Browser identity check and cleanup both failed');
		}
		throw error;
	}
}
