/**
 * @fileoverview 生成Chrome扩展所需的多尺寸图标 (16, 48, 128)
 * 源文件: icon.svg (矢量图)
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG = {
  // 修改这里：指向新的 svg 文件
  sourceIcon: path.resolve(__dirname, '../apps/extension-spectra/public/icon.svg'),
  outputDir: path.resolve(__dirname, '../apps/extension-spectra/public/icons'),
  sizes: [16, 48, 128],
};

async function generateIcons() {
  console.log('[ICON] 开始矢量栅格化处理...');
  
  if (!fs.existsSync(CONFIG.outputDir)) {
	fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  // 针对每个尺寸单独处理，以获得最佳抗锯齿效果
  for (const size of CONFIG.sizes) {
	const outputPath = path.join(CONFIG.outputDir, `icon${size}.png`);
	
	// Sharp 处理 SVG 的技巧：
	// 不使用 .resize()，而是直接在加载 SVG 时指定 density 或 resize，
	// 这样 sharp 会重新渲染矢量，而不是缩放像素。
	await sharp(CONFIG.sourceIcon)
	  .resize(size, size) // 对 SVG 来说，这里会触发重新渲染
	  .png({
		compressionLevel: 9, // 最高压缩
		adaptiveFiltering: true,
		force: true
	  })
	  .toFile(outputPath);
	
	console.log(`[ICON] ✓ 生成: icon${size}.png (由矢量渲染)`);
  }

  console.log('[ICON] 图标生成完成！');
}

generateIcons().catch(err => {
  console.error('[ICON] 失败:', err);
  process.exit(1);
});