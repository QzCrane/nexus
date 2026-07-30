/**
 * 白色背景转透明 (柔和抗锯齿版)
 * 策略: 白色检测 + 多层渐变透明边缘
 */

import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// === 配置 ===
const CONFIG = {
  input: path.resolve(__dirname, '../apps/extension-spectra/public/source_icon_jpg.png'),
  output: path.resolve(__dirname, '../apps/extension-spectra/public/icon_transparent.png'),
  
  pureWhiteThreshold: 230,
  nearWhiteThreshold: 140,
  colorTolerance: 50,
  
  // 边缘渐变层数 (每层透明度递增)
  gradientLayers: 4,
  
  colorSearchRadius: 8,
};

function isWhitish(r, g, b, threshold = CONFIG.nearWhiteThreshold) {
  const avg = (r + g + b) / 3;
  const maxDiff = Math.max(Math.abs(r - avg), Math.abs(g - avg), Math.abs(b - avg));
  return avg >= threshold && maxDiff <= CONFIG.colorTolerance;
}

function getWhiteness(r, g, b) {
  if (!isWhitish(r, g, b)) return 0;
  const avg = (r + g + b) / 3;
  return Math.min(1, Math.max(0, 
    (avg - CONFIG.nearWhiteThreshold) / (CONFIG.pureWhiteThreshold - CONFIG.nearWhiteThreshold)
  ));
}

/**
 * 计算像素到透明区域的距离 (用于渐变)
 */
function computeDistanceToTransparent(alphaMask, width, height, maxDist) {
  const distMap = new Float32Array(alphaMask.length);
  
  // 初始化：透明=0，不透明=maxDist
  for (let i = 0; i < alphaMask.length; i++) {
    distMap[i] = alphaMask[i] === 0 ? 0 : maxDist;
  }
  
  // 前向扫描
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (distMap[i] > 0) {
        if (x > 0) distMap[i] = Math.min(distMap[i], distMap[i - 1] + 1);
        if (y > 0) distMap[i] = Math.min(distMap[i], distMap[i - width] + 1);
      }
    }
  }
  
  // 后向扫描
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (distMap[i] > 0) {
        if (x < width - 1) distMap[i] = Math.min(distMap[i], distMap[i + 1] + 1);
        if (y < height - 1) distMap[i] = Math.min(distMap[i], distMap[i + width] + 1);
      }
    }
  }
  
  return distMap;
}

function findNearbyColor(pixels, alphaMask, x, y, width, height) {
  const radius = CONFIG.colorSearchRadius;
  let totalR = 0, totalG = 0, totalB = 0, totalWeight = 0;
  
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      
      const ni = ny * width + nx;
      const idx = ni * 4;
      
      if (alphaMask[ni] === 255) {
        const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
        if (!isWhitish(r, g, b)) {
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const w = 1 / dist;
          totalR += r * w; totalG += g * w; totalB += b * w;
          totalWeight += w;
        }
      }
    }
  }
  
  if (totalWeight === 0) return null;
  return {
    r: Math.round(totalR / totalWeight),
    g: Math.round(totalG / totalWeight),
    b: Math.round(totalB / totalWeight),
  };
}

async function removeWhiteBackground() {
  console.log('[BG-REMOVE] 开始处理 (柔和抗锯齿版)...');

  const { data, info } = await sharp(CONFIG.input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  const { width, height } = info;
  const total = width * height;
  
  console.log('[BG-REMOVE] 尺寸:', width, 'x', height);

  // 1. 初始白度标记
  const alphaMask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const w = getWhiteness(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
    alphaMask[i] = w >= 0.5 ? 0 : 255;
  }
  
  console.log('[BG-REMOVE] 透明像素:', [...alphaMask].filter(a => a === 0).length);

  // 2. 计算到透明区域的距离
  const layers = CONFIG.gradientLayers;
  const distMap = computeDistanceToTransparent(alphaMask, width, height, layers + 1);
  
  // 3. 应用渐变透明度 + 颜色修复
  let gradientCount = 0, fixedCount = 0;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const idx = i * 4;
      const dist = distMap[i];
      
      if (dist === 0) {
        // 完全透明
        pixels[idx + 3] = 0;
      } else if (dist <= layers) {
        // 渐变区域：距离越近透明度越低
        const alpha = Math.round(255 * (dist / (layers + 1)));
        pixels[idx + 3] = alpha;
        gradientCount++;
        
        // 颜色修复
        const color = findNearbyColor(pixels, alphaMask, x, y, width, height);
        if (color) {
          const blend = dist / (layers + 1); // 0→原色, 1→邻近色
          pixels[idx] = Math.round(pixels[idx] * (1 - blend) + color.r * blend);
          pixels[idx + 1] = Math.round(pixels[idx + 1] * (1 - blend) + color.g * blend);
          pixels[idx + 2] = Math.round(pixels[idx + 2] * (1 - blend) + color.b * blend);
          fixedCount++;
        }
      }
      // dist > layers: 保持完全不透明
    }
  }

  console.log('[BG-REMOVE] 渐变像素:', gradientCount);
  console.log('[BG-REMOVE] 颜色混合:', fixedCount);

  await sharp(Buffer.from(pixels), { raw: { width, height, channels: 4 } })
    .png()
    .toFile(CONFIG.output);

  console.log('[BG-REMOVE] 完成:', CONFIG.output);
}

removeWhiteBackground().catch(e => { console.error(e); process.exit(1); });
