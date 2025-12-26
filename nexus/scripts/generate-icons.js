/**
 * @fileoverview 图标生成工具：支持 SVG 矢量或 PNG 位图源文件
 * 逻辑：优先检测 SVG 源，若不存在则回退至 PNG 源
 */

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ========== 配置中心 ==========
const CONFIG = {
  // 路径配置（相对于当前脚本）
  paths: {
    base: path.resolve(__dirname, '../apps/extension-spectra/public'),
    output: path.resolve(__dirname, '../apps/extension-spectra/public/icons'),
  },
  // 源文件优先级（按顺序尝试）
  sources: [
    'icon_transparent.png',
    // 'icon.svg'
  ],
  // 标准尺寸
  sizes: [16, 48, 128],
};

/**
 * 获取最合适的源文件路径
 */
function getSourcePath() {
  for (const fileName of CONFIG.sources) {
    const fullPath = path.join(CONFIG.paths.base, fileName);
    if (fs.existsSync(fullPath)) {
      return { path: fullPath, type: path.extname(fileName).toLowerCase() };
    }
  }
  return null;
}

async function generateIcons() {
  const source = getSourcePath();

  if (!source) {
    console.error(`[ICON] ❌ 未找到源图标文件。尝试检查: ${CONFIG.sources.join(', ')}`);
    process.exit(1);
  }

  console.log(`[ICON] 🚀 开始处理...`);
  console.log(`[ICON] 📥 源文件: ${path.basename(source.path)} (${source.type})`);
  console.log(`[ICON] 📂 输出目录: ${CONFIG.paths.output}`);

  // 确保输出目录存在
  if (!fs.existsSync(CONFIG.paths.output)) {
    fs.mkdirSync(CONFIG.paths.output, { recursive: true });
    console.log('[ICON] 📁 已创建输出目录');
  }

  for (const size of CONFIG.sizes) {
    const outputPath = path.join(CONFIG.paths.output, `icon${size}.png`);
    
    let pipeline = sharp(source.path);

    if (source.type === '.svg') {
      // SVG 渲染：resize 会触发矢量重新采样，比像素缩放更清晰
      pipeline = pipeline.resize(size, size);
    } else {
      // PNG 处理：确保背景透明并居中缩放
      pipeline = pipeline.resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      });
    }

    await pipeline
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
        force: true
      })
      .toFile(outputPath);
    
    console.log(`[ICON] ✅ 生成: icon${size}.png`);
  }

  console.log('[ICON] ✨ 所有图标已就绪！');
}

generateIcons().catch(err => {
  console.error('[ICON] 💥 发生错误:', err);
  process.exit(1);
});
