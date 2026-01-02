/**
 * Halo E2E Test Setup
 * Provides utilities for launching Chrome with the extension loaded.
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extension build output path
const EXTENSION_PATH = path.resolve(__dirname, '../dist');

// Screenshot output directory
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

/**
 * Launch Chrome with the Halo extension loaded
 */
export async function launchWithExtension(): Promise<Browser> {
	console.log('🚀 Launching Chrome with Halo Extension at:', EXTENSION_PATH);

	// Ensure dist exists
	if (!fs.existsSync(EXTENSION_PATH)) {
		throw new Error(`Extension dist not found at ${EXTENSION_PATH}. Run 'pnpm build' first.`);
	}

	const browser = await puppeteer.launch({
		headless: false, // Extensions require headed mode
		defaultViewport: { width: 1280, height: 800 },
		args: [
			`--disable-extensions-except=${EXTENSION_PATH}`,
			`--load-extension=${EXTENSION_PATH}`,
			'--no-sandbox',
			'--disable-setuid-sandbox',
		],
	});

	return browser;
}

/**
 * Get the extension ID from the browser targets (with retry for slow startup)
 */
export async function getExtensionId(browser: Browser): Promise<string> {
	const maxRetries = 10;
	const retryDelay = 500;

	for (let i = 0; i < maxRetries; i++) {
		const targets = await browser.targets();
		const workerTarget = targets.find((t) => t.type() === 'service_worker');

		if (workerTarget) {
			const url = workerTarget.url();
			const match = url.match(/chrome-extension:\/\/([a-z0-9]+)\//);

			if (match && match[1]) {
				return match[1];
			}
		}

		console.log(`⏳ Waiting for Service Worker... (${i + 1}/${maxRetries})`);
		await wait(retryDelay);
	}

	throw new Error('Extension Service Worker not found after retries');
}

/**
 * Open the SidePanel page directly (as a workaround since Puppeteer can't trigger the real side panel)
 */
export async function openSidePanel(browser: Browser): Promise<Page> {
	const extId = await getExtensionId(browser);
	const sidepanelUrl = `chrome-extension://${extId}/sidepanel.html`;

	console.log('📂 Opening SidePanel at:', sidepanelUrl);

	const page = await browser.newPage();
	await page.goto(sidepanelUrl, { waitUntil: 'networkidle0' });

	// Wait for React to render
	await wait(1500);

	return page;
}

/**
 * Take a screenshot and save to the screenshots directory
 */
export async function takeScreenshot(page: Page, name: string): Promise<string> {
	// Ensure screenshot dir exists
	if (!fs.existsSync(SCREENSHOT_DIR)) {
		fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	}

	const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
	await page.screenshot({ path: filepath, fullPage: true });
	console.log(`📸 Screenshot saved: ${filepath}`);

	return filepath;
}

/**
 * Simple delay utility
 */
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
