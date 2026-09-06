import { browserReplayPolicy } from '../../../scripts/browser-replay';
const EXPLICIT_CHROME = process.env.NEXUS_CHROME_EXECUTABLE?.trim();
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	chromium,
	expect,
	test,
	type BrowserContext,
	type Worker,
} from '@playwright/test';

const DIST_PATH = fileURLToPath(new URL('../dist/', import.meta.url));

async function extensionWorker(context: BrowserContext): Promise<Worker> {
	const existing = context.serviceWorkers()[0];
	if (existing) return existing;
	return context.waitForEvent('serviceworker', { timeout: 10_000 });
}

function parseCssTime(value: string): number {
	const trimmed = value.trim();
	if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed);
	if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1_000;
	return Number.NaN;
}

test.describe('HALO SidePanel accessibility contract', () => {
	test('keeps semantic controls, keyboard focus, reflow, contrast and reduced motion usable', async () => {
		test.setTimeout(45_000);
		const profilePath = await mkdtemp(join(tmpdir(), 'halo-a11y-'));
		let context: BrowserContext | null = null;
		try {
			context = await chromium.launchPersistentContext(profilePath, {
				...(EXPLICIT_CHROME ? { executablePath: EXPLICIT_CHROME } : { channel: 'chromium' as const }),
				headless: true,
				reducedMotion: 'reduce',
				viewport: { width: 320, height: 720 },
				args: [
					...browserReplayPolicy(process.env.NEXUS_EXPECTED_CHROME_VERSION?.trim(), EXPLICIT_CHROME, process.platform).args,
					`--disable-extensions-except=${DIST_PATH}`,
					`--load-extension=${DIST_PATH}`,
				],
			});
			const worker = await extensionWorker(context);
			const extensionId = new URL(worker.url()).hostname;
			const page = context.pages()[0] ?? await context.newPage();
			await page.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'load' });

			const jsonFormatter = page.locator('button[data-tool-id="json-formatter"]');
			await expect(jsonFormatter).toBeVisible();
			await expect(jsonFormatter).toBeEnabled();

			const cdp = await context.newCDPSession(page);
			await cdp.send('Accessibility.enable');
			const tree = await cdp.send('Accessibility.getFullAXTree');
			const semanticNodes = tree.nodes.filter((node) => !node.ignored);
			const textbox = semanticNodes.find((node) => node.role?.value === 'textbox');
			expect(String(textbox?.name?.value ?? '').trim().length).toBeGreaterThan(0);
			const jsonButton = semanticNodes.find((node) => (
				node.role?.value === 'button'
				&& /json/i.test(String(node.name?.value ?? ''))
			));
			expect(jsonButton).toBeTruthy();

			await page.keyboard.press('Tab');
			const focus = await page.evaluate(() => {
				const active = document.activeElement as HTMLElement | null;
				if (!active) return null;
				const style = getComputedStyle(active);
				return {
					tag: active.tagName,
					outlineStyle: style.outlineStyle,
					outlineWidth: Number.parseFloat(style.outlineWidth),
				};
			});
			expect(focus).not.toBeNull();
			expect(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT']).toContain(focus?.tag);
			expect(focus?.outlineStyle).not.toBe('none');
			expect(focus?.outlineWidth ?? 0).toBeGreaterThanOrEqual(2);

			const layout = await page.evaluate(() => ({
				viewport: window.innerWidth,
				documentWidth: document.documentElement.scrollWidth,
				rootWidth: document.getElementById('root')?.scrollWidth ?? 0,
			}));
			expect(layout.viewport).toBe(320);
			expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport);
			expect(layout.rootWidth).toBeLessThanOrEqual(layout.viewport);

			const defaultContrast = await page.evaluate(() => {
				const style = getComputedStyle(document.documentElement);
				const parse = (value: string) => {
					const match = /^#([0-9a-f]{6})$/iu.exec(value.trim());
					if (!match) throw new Error(`Expected six-digit hex color, got ${value}`);
					const hex = match[1] ?? '';
					return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
				};
				const luminance = (rgb: number[]) => {
					const linear = rgb.map((channel) => channel <= 0.04045
						? channel / 12.92
						: ((channel + 0.055) / 1.055) ** 2.4);
					return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
				};
				const foreground = luminance(parse(style.getPropertyValue('--halo-text-muted')));
				const background = luminance(parse(style.getPropertyValue('--halo-bg-tertiary')));
				const lighter = Math.max(foreground, background);
				const darker = Math.min(foreground, background);
				return (lighter + 0.05) / (darker + 0.05);
			});
			expect(defaultContrast).toBeGreaterThanOrEqual(4.5);

			const reducedMotion = await page.evaluate(() => {
				const target = document.querySelector<HTMLElement>('button[data-tool-id="json-formatter"]');
				if (!target) throw new Error('JSON Formatter button missing');
				const style = getComputedStyle(target);
				return {
					matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
					animationDuration: style.animationDuration,
					transitionDuration: style.transitionDuration,
				};
			});
			expect(reducedMotion.matches).toBe(true);
			for (const value of [reducedMotion.animationDuration, reducedMotion.transitionDuration]) {
				for (const duration of value.split(',').map(parseCssTime)) {
					expect(Number.isFinite(duration)).toBe(true);
					expect(duration).toBeLessThanOrEqual(0.02);
				}
			}
		} finally {
			await context?.close();
			await rm(profilePath, {
				force: true,
				recursive: true,
				maxRetries: 3,
				retryDelay: 100,
			});
		}
	});
});
