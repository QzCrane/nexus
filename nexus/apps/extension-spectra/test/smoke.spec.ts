import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer';

const EXTENSION_DIR = join(import.meta.dir, '..', 'dist');
const TEST_PAGE = 'data:text/html,<html><body><video id="v" controls src="https://sample-videos.com/video321/mp4/240/big_buck_bunny_240p_1mb.mp4"></video></body></html>';

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  page = await browser.newPage();
  await page.goto(TEST_PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#v');
}, 30000);

afterAll(async () => {
  await browser?.close();
});

describe('SPECTRA Smoke Test', () => {
  it('content script injects data attribute', async () => {
    const attr = await page.$eval('html', el => el.getAttribute('data-spectra-content-loaded'));
    expect(attr).toBe('true');
  });

  it('video element supports playbackRate (speed API)', async () => {
    const rate = await page.$eval('#v', (el) => {
      const v = el as HTMLVideoElement;
      v.playbackRate = 2.0;
      return v.playbackRate;
    });
    expect(rate).toBeGreaterThanOrEqual(1.9);
    expect(rate).toBeLessThanOrEqual(2.1);
  });

  it('video element has volume api accessible', async () => {
    const vol = await page.$eval('#v', (el) => {
      const v = el as HTMLVideoElement;
      v.volume = 0.5;
      return v.volume;
    });
    expect(vol).toBeGreaterThan(0.4);
    expect(vol).toBeLessThan(0.6);
  });
});