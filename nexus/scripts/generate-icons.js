/**
 * @fileoverview 生成Chrome扩展所需的多尺寸图标 (16x16, 48x48, 128x128)
 * 源图标: apps/extension-spectra/public/icon.png
 * 输出目录: apps/extension-spectra/public/icons/
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ========== 配置 ==========
const CONFIG = {
  sourceIcon: path.resolve(__dirname, '../apps/extension-spectra/public/icon.png'),
  outputDir: path.resolve(__dirname, '../apps/extension-spectra/public/icons'),
  sizes: [16, 48, 128],  // Chrome扩展标准尺寸
  addWhiteBg: true,      // 是否添加白色背景（解决透明图标显示灰色问题）
};

async function generateIcons() {
  console.log('[ICON] 开始生成图标...');
  console.log(`[ICON] 源文件: ${CONFIG.sourceIcon}`);
  console.log(`[ICON] 输出目录: ${CONFIG.outputDir}`);

  // 确保输出目录存在
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    console.log('[ICON] 创建输出目录');
  }

  // 读取源图标
  const sourceBuffer = await sharp(CONFIG.sourceIcon).png().toBuffer();
  const metadata = await sharp(sourceBuffer).metadata();
  console.log(`[ICON] 源图标尺寸: ${metadata.width}x${metadata.height}`);

  // 生成各尺寸
  for (const size of CONFIG.sizes) {
    const outputPath = path.join(CONFIG.outputDir, `icon${size}.png`);
    
    let pipeline = sharp(sourceBuffer).resize(size, size, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    });

    // 添加白色背景（可选）
    if (CONFIG.addWhiteBg) {
      pipeline = pipeline.flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    await pipeline.png().toFile(outputPath);
    console.log(`[ICON] ✓ 生成: icon${size}.png`);
  }

  console.log('[ICON] 图标生成完成！');
}

generateIcons().catch(err => {
  console.error('[ICON] 生成失败:', err);
  process.exit(1);
});
