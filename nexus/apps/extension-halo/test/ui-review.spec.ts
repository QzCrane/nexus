/**
 * Halo UI Review Test
 * Captures screenshots of each tool panel for visual inspection.
 */

import { launchWithExtension, getExtensionId, takeScreenshot, wait } from './setup.js';
import type { Browser, Page } from 'puppeteer';

// Tools to test (a subset for initial review)
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

/**
 * Navigate to sidepanel and wait for React to fully render
 */
async function openSidePanelWithRetry(browser: Browser): Promise<Page> {
	const extId = await getExtensionId(browser);
	const sidepanelUrl = `chrome-extension://${extId}/sidepanel.html`;

	console.log('📂 Opening SidePanel at:', sidepanelUrl);

	const page = await browser.newPage();

	// Set up error tracking BEFORE navigation
	await page.evaluateOnNewDocument(() => {
		(window as any).__pageErrors = [];
		window.onerror = (msg, src, line, col, error) => {
			(window as any).__pageErrors.push({ msg, src, line, col, error: error?.stack });
			console.error('SCRIPT ERROR:', msg, 'at', src, line, col);
		};
		window.addEventListener('unhandledrejection', (e) => {
			(window as any).__pageErrors.push({ type: 'unhandledrejection', reason: String(e.reason) });
			console.error('UNHANDLED REJECTION:', e.reason);
		});
	});

	// Capture console messages
	page.on('console', (msg) => console.log('PAGE LOG:', msg.type(), msg.text()));
	page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

	// Navigate
	await page.goto(sidepanelUrl, { waitUntil: 'load', timeout: 30000 });

	// Check for script errors
	const errors = await page.evaluate(() => (window as any).__pageErrors || []);
	if (errors.length > 0) {
		console.log('🔴 Captured errors:', JSON.stringify(errors, null, 2));
	}

	// Wait for React to render
	const maxAttempts = 40;
	let attempt = 0;
	let foundButtons = false;

	while (attempt < maxAttempts && !foundButtons) {
		const buttonCount = await page.$$eval('button[data-tool-id]', (btns) => btns.length).catch(() => 0);
		if (buttonCount > 0) {
			foundButtons = true;
			console.log(`✅ Found ${buttonCount} tool buttons after ${attempt * 500}ms`);
		} else {
			if (attempt === 10) {
				console.log('⏳ Trying page refresh...');
				await page.reload({ waitUntil: 'load' });
				// Check errors again after refresh
				const errorsAfterRefresh = await page.evaluate(() => (window as any).__pageErrors || []);
				if (errorsAfterRefresh.length > 0) {
					console.log('🔴 Errors after refresh:', JSON.stringify(errorsAfterRefresh, null, 2));
				}
			}
			await wait(500);
			attempt++;
			if (attempt % 4 === 0) {
				const bodyContent = await page.evaluate(() => document.body?.textContent?.slice(0, 100) || '').catch(() => '');
				console.log(`⏳ Still waiting... (${attempt * 500}ms) - Page says: "${bodyContent.trim()}"`);
			}
		}
	}

	if (!foundButtons) {
		console.log('❌ React did not render tool buttons in time');
		// Final error check
		const finalErrors = await page.evaluate(() => (window as any).__pageErrors || []);
		console.log('🔴 Final errors:', JSON.stringify(finalErrors, null, 2));
		const fullBody = await page.evaluate(() => document.body?.innerHTML || '').catch(() => '');
		console.log('Full body:', fullBody.slice(0, 2000));
	}

	return page;
}

async function run() {
	let browser;

	try {
		// 1. Build is assumed to be done before running (via package.json script)
		browser = await launchWithExtension();

		// 2. Open SidePanel with retry logic
		const page = await openSidePanelWithRetry(browser);

		// 3. Take homepage screenshot
		await takeScreenshot(page, '00-homepage');
		console.log('✅ Homepage captured');

		// 4. Click each tool and capture its panel
		for (let i = 0; i < TOOLS_TO_REVIEW.length; i++) {
			const toolId = TOOLS_TO_REVIEW[i];
			console.log(`\n🔧 Testing tool: ${toolId}`);

			try {
				const toolSelector = `button[data-tool-id="${toolId}"]`;
				const toolButton = await page.$(toolSelector);

				if (toolButton) {
					await toolButton.click();
					await wait(500);
					await takeScreenshot(page, `${String(i + 1).padStart(2, '0')}-${toolId}`);
					console.log(`✅ ${toolId} captured`);
					await page.keyboard.press('Escape');
					await wait(300);
				} else {
					console.log(`⚠️ Tool button not found for: ${toolId}`);
				}
			} catch (err) {
				console.error(`❌ Error testing ${toolId}:`, err);
			}
		}

		console.log('\n🎉 UI Review Complete! Check test/screenshots/ for results.');
	} catch (error) {
		console.error('❌ Test Error:', error);
		process.exit(1);
	} finally {
		if (browser) {
			await wait(5000);
			await browser.close();
		}
	}
}

run();
