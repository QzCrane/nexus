
import { launchToTest, wait } from './setup.js';

async function run() {
  let browser;
  try {
    // 1. 启动带有插件的浏览器
    browser = await launchToTest();

    // 2. 打开一个普通网页
    const page = await browser.newPage();
    
    // 监听页面控制台日志
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err: any) => console.log('PAGE ERROR:', err.toString()));

    console.log('📄 Navigating to example.com...');
    await page.goto('https://example.com', { waitUntil: 'networkidle0' });

    // 3. 等待注入 (Content Script 是异步执行的)
    await wait(1000);

    // 4. 验证注入状态
    console.log('🔍 Checking for Content Script injection...');
    const isInjected = await page.evaluate(() => {
      return document.documentElement.hasAttribute('data-spectra-injected');
    });

    if (isInjected) {
      console.log('✅ TEST PASSED: SPECTRA Content Script successfully injected!');
    } else {
      console.error('❌ TEST FAILED: Content Script NOT detected.');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ TEST ERROR:', error);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

run();
