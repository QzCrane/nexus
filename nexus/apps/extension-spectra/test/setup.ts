
import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 扩展构建产物的绝对路径
const EXTENSION_PATH = path.resolve(__dirname, '../dist');

export async function launchToTest() {
  console.log('🚀 Launching Chrome with Extension at:', EXTENSION_PATH);

  const browser = await puppeteer.launch({
    headless: false, // Chrome 扩展不支持在旧版 Headless 模式下运行，新版 'new' 也可以尝试但 false 最稳
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  return browser;
}

// 简单的延迟函数
export const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

// 获取扩展 ID 的辅助函数
export async function getExtensionId(browser: Browser): Promise<string> {
  // 查找 service worker 目标
  const targets = await browser.targets();
  const workerTarget = targets.find(t => t.type() === 'service_worker');
  
  if (!workerTarget) {
    throw new Error('Extension Service Worker not found via browser.targets()');
  }

  // URL 格式: chrome-extension://<ID>/background.js
  const url = workerTarget.url();
  const match = url.match(/chrome-extension:\/\/([a-z0-9]+)\//);
  
  if (match && match[1]) {
    return match[1];
  }
  
  throw new Error('Could not parse Extension ID from URL: ' + url);
}
