import type { BrowserContext, Worker } from '@playwright/test';

const BACKGROUND_URL = /^chrome-extension:\/\/[a-p]{32}\/background\.js$/u;

export async function extensionWorker(context: BrowserContext, timeoutMs = 10_000): Promise<Worker> {
	const deadline = Date.now() + timeoutMs;
	const matches = (worker: Worker): boolean => BACKGROUND_URL.test(worker.url());
	const worker = context.serviceWorkers().find(matches)
		?? await context.waitForEvent('serviceworker', { predicate: matches, timeout: timeoutMs });
	const extensionId = new URL(worker.url()).hostname;
	// A CDP target event is not proof that the native extension bindings have
	// been installed. Keep the exact extension identity and all required APIs.
	while (true) {
		const ready = await worker.evaluate((expectedId) => typeof chrome !== 'undefined'
			&& chrome.runtime?.id === expectedId
			&& typeof chrome.runtime?.sendMessage === 'function'
			&& typeof chrome.storage?.sync?.set === 'function'
			&& typeof chrome.storage?.local?.set === 'function'
			&& typeof chrome.tabs?.query === 'function'
			&& typeof chrome.permissions?.getAll === 'function', extensionId);
		if (ready) return worker;
		if (Date.now() >= deadline) {
			throw new Error(`HALO extension bindings did not become ready: ${worker.url()}`);
		}
		await new Promise((resolve) => setTimeout(resolve, Math.min(20, Math.max(0, deadline - Date.now()))));
	}
}
