
import { launchToTest, wait, getExtensionId } from './setup.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PATH = 'file://' + path.resolve(__dirname, 'fixtures/media-page.html');

async function run() {
  let browser;
  try {
    browser = await launchToTest();
    
    // 1. 获取扩展 ID (需要等 Service Worker 启动)
    await wait(1000);
    const extensionId = await getExtensionId(browser);
    console.log('🆔 Extension ID:', extensionId);

    // 2. 打开媒体测试页面
    console.log('🎶 Opening Media Page:', FIXTURE_PATH);
    const mediaPage = await browser.newPage();
    await mediaPage.goto(FIXTURE_PATH);
    
    // 这是一个特殊的 trick：必须先点击一下页面以激活 Policy 里的 User Gesture
    await mediaPage.click('h1');
    
    // 3. 打开 Popup 页面 (模拟点击扩展图标)
    console.log('📱 Opening Extension Popup...');
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const popupPage = await browser.newPage();
    await popupPage.goto(popupUrl);
    
    // 监听页面 Log
    mediaPage.on('console', msg => console.log('PAGE LOG:', msg.text()));

    // 4. 等待 Popup 渲染
    await wait(1500); 
    
    // 5. 调整音量 (查找 Slider)
    console.log('🎚️ Adjusting Volume in Popup...');
    
    // 由于 Shadow DOM 或者复杂的渲染，直接用 evaluate 方便
    const sliderFound = await popupPage.evaluate(() => {
        const slider = document.querySelector('.vol-slider') as HTMLInputElement;
        if (!slider) return false;
        
        // 模拟用户拖动：修改值并派发 input 事件
        slider.value = '300';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    });

    if (!sliderFound) {
      throw new Error('❌ TEST FAILED: Volume Slider not found in Popup.');
    }
    
    // 6. 验证 Content Script 里的效果
    await wait(1500); // 等待消息传递
    
    console.log('🔍 Verifying volume on Media Page...');
    const audioState = await mediaPage.evaluate(() => {
        // SPECTRA 修改的是 video.volume 还是 WebAudio GainNode?
        // 在 Native Lite 模式下是 video.volume
        // 在 WebAudio 模式下 video.volume 通常保持 1，gain node 改变
        // 但根据新的逻辑，WebAudio 模式下 video.volume 用来控制静音，实际放大靠 AudioContext
        
        // 我们这里只检查 DOM 元素是否有被操作的迹象
        const video = document.querySelector('video') as HTMLMediaElement;
        
        return {
            muted: video.muted,
            volume: video.volume,
            // 还可以通过检测是否挂载了 audio-graph 可视化数据来判断
            injected: document.documentElement.hasAttribute('data-spectra-injected')
        };
    });

    console.log('📊 Audio State:', audioState);

    // 目前的预期：
    // 如果是 DOM 模式（Native Lite），video.volume 应该被设为 1 (如果 300% 超过100%) 或者相应比例
    // SPECTRA 定义: 300% -> volume 1, Gain 3.0
    
    // 如果 Content Script 生效，volume 应该是 1 (因为 300 > 100)
    if (audioState.volume === 1) {
       console.log('✅ TEST PASSED: Volume logic reached Content Script!');
    } else {
       console.error('❌ TEST FAILED: Volume did not sync.');
       process.exit(1);
    }

  } catch (error) {
    console.error('❌ TEST ERROR:', error);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

run();
