/**
 * Halo UI Review Test (Playwright Version)
 * Uses persistent context to preserve IndexedDB state across sessions.
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extension build output path
const EXTENSION_PATH = path.resolve(__dirname, '../dist');
// Persistent user data directory (preserves IndexedDB)
const USER_DATA_DIR = path.resolve(__dirname, '.playwright-user-data');
// Screenshot output directory
const SCREENSHOT_DIR = path.resolve(__dirname, 'screenshots');

// Tools to test
const TOOLS_TO_REVIEW = [
	'qrcode',
	'color-picker',
	'json-formatter',
	'base64',
	'hash',
	'uuid',
	'timestamp',
	'url',
	'regex',
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Launch browser with extension using persistent context
 */
async function launchWithExtension(): Promise<BrowserContext> {
	console.log('🚀 Launching Chrome with Halo Extension at:', EXTENSION_PATH);

	if (!fs.existsSync(EXTENSION_PATH)) {
		throw new Error(`Extension dist not found at ${EXTENSION_PATH}. Run 'pnpm build' first.`);
	}

	// Ensure screenshot dir exists
	if (!fs.existsSync(SCREENSHOT_DIR)) {
		fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	}

	const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
		headless: false,
		args: [
			`--disable-extensions-except=${EXTENSION_PATH}`,
			`--load-extension=${EXTENSION_PATH}`,
			'--no-sandbox',
		],
		viewport: { width: 400, height: 700 }, // SidePanel-like dimensions
	});

	return context;
}

/**
 * Get extension ID from service workers
 */
async function getExtensionId(context: BrowserContext): Promise<string> {
	// Wait for service worker to register
	let attempts = 0;
	while (attempts < 20) {
		const workers = context.serviceWorkers();
		for (const worker of workers) {
			const url = worker.url();
			const match = url.match(/chrome-extension:\/\/([a-z0-9]+)\//);
			if (match && match[1]) {
				console.log('✅ Found extension ID:', match[1]);
				return match[1];
			}
		}
		await wait(500);
		attempts++;
		if (attempts % 4 === 0) {
			console.log(`⏳ Waiting for extension service worker... (${attempts * 500}ms)`);
		}
	}
	throw new Error('Extension service worker not found');
}

/**
 * Take a screenshot
 */
async function takeScreenshot(page: Page, name: string): Promise<void> {
	const filepath = path.join(SCREENSHOT_DIR, `${name}.png`);
	await page.screenshot({ path: filepath, fullPage: true });
	console.log(`📸 Screenshot saved: ${filepath}`);
}

async function run() {
	let context: BrowserContext | null = null;

	try {
		// 1. Launch browser with extension
		context = await launchWithExtension();

		// 2. Get extension ID
		const extId = await getExtensionId(context);
		const sidepanelUrl = `chrome-extension://${extId}/sidepanel.html`;

		// 3. Open SidePanel
		console.log('📂 Opening SidePanel at:', sidepanelUrl);
		const page = await context.newPage();

		// Listen for console and errors
		page.on('console', (msg) => console.log('PAGE LOG:', msg.type(), msg.text()));
		page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

		await page.goto(sidepanelUrl, { waitUntil: 'load' });

		// 4. Wait for React to render (with persistent context, IndexedDB should already be populated)
		console.log('⏳ Waiting for React to render...');
		let attempts = 0;
		const maxAttempts = 40;

		while (attempts < maxAttempts) {
			const buttonCount = await page.locator('button[data-tool-id]').count();
			if (buttonCount > 0) {
				console.log(`✅ Found ${buttonCount} tool buttons after ${attempts * 500}ms`);
				break;
			}
			await wait(500);
			attempts++;
			if (attempts % 4 === 0) {
				const text = await page.locator('body').textContent() || '';
				console.log(`⏳ Still waiting... (${attempts * 500}ms) - "${text.slice(0, 50).trim()}"`);
			}
		}

		// 5. Take homepage screenshot
		await takeScreenshot(page, '00-homepage');
		console.log('✅ Homepage captured');

		// 6. Click each tool and capture
		for (let i = 0; i < TOOLS_TO_REVIEW.length; i++) {
			const toolId = TOOLS_TO_REVIEW[i];
			console.log(`\n🔧 Testing tool: ${toolId}`);

			try {
				// Use JavaScript click to bypass viewport restrictions
				const clicked = await page.evaluate((id) => {
					const btn = document.querySelector(`button[data-tool-id="${id}"]`) as HTMLButtonElement;
					if (btn) {
						btn.click();
						return true;
					}
					return false;
				}, toolId);

				if (clicked) {
					await wait(500);
					await takeScreenshot(page, `${String(i + 1).padStart(2, '0')}-${toolId}`);
					console.log(`✅ ${toolId} captured`);
					await page.keyboard.press('Escape');
					await wait(300);
				} else {
					console.log(`⚠️ Tool button not found for: ${toolId}`);
				}
			} catch (err) {
				console.log(`⚠️ Error clicking ${toolId}:`, err);
			}
		}

		console.log('\n🎉 UI Review Complete! Check test/screenshots/ for results.');

	} catch (error) {
		console.error('❌ Test Error:', error);
		process.exit(1);
	} finally {
		if (context) {
			await wait(3000);
			await context.close();
		}
	}
}

run();
