import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// 目标尺寸
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 800;

// 舒适的深色背景 (类似 VS Code / Discord 深色主题)
// #1e1e2e - 柔和的深蓝灰，不刺眼
const BG_COLOR = { r: 30, g: 30, b: 46 };

// 输入输出目录
const inputDir = './';
const outputDir = './store/screenshots/';

// 选5张最有代表性的截图 (用remote替换qrcode)
const screenshots = [
  { src: 'pouup.png', out: 'screenshot-1-popup.png', label: '主界面' },
  { src: 'sidebar.png', out: 'screenshot-2-sidebar.png', label: '侧边栏EQ' },
  { src: 'hotkeys.png', out: 'screenshot-3-hotkeys.png', label: '快捷键' },
  { src: 'setting.png', out: 'screenshot-4-settings.png', label: '设置' },
  { src: 'remote.png', out: 'screenshot-5-remote.png', label: '远程控制' },
];

async function processImage(srcFile, outFile, label) {
  const srcPath = path.join(inputDir, srcFile);
  const outPath = path.join(outputDir, outFile);

  try {
    const metadata = await sharp(srcPath).metadata();
    const srcWidth = metadata.width;
    const srcHeight = metadata.height;

    // 缩放比例 (保持宽高比，留10%边距)
    const scale = Math.min(
      (TARGET_WIDTH * 0.9) / srcWidth,
      (TARGET_HEIGHT * 0.9) / srcHeight
    );

    const newWidth = Math.round(srcWidth * scale);
    const newHeight = Math.round(srcHeight * scale);

    // 居中位置
    const left = Math.round((TARGET_WIDTH - newWidth) / 2);
    const top = Math.round((TARGET_HEIGHT - newHeight) / 2);

    // 创建背景画布
    const background = await sharp({
      create: {
        width: TARGET_WIDTH,
        height: TARGET_HEIGHT,
        channels: 3,
        background: BG_COLOR
      }
    }).png().toBuffer();

    // 缩放并去除透明层
    const resized = await sharp(srcPath)
      .resize(newWidth, newHeight)
      .flatten({ background: BG_COLOR })
      .toBuffer();

    // 合成输出
    await sharp(background)
      .composite([{ input: resized, left, top }])
      .png()
      .toFile(outPath);

    console.log(`✅ ${label}: ${srcWidth}x${srcHeight} -> ${outFile}`);
  } catch (err) {
    console.error(`❌ ${label}: ${err.message}`);
  }
}

async function main() {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\n📸 处理截图 -> ${TARGET_WIDTH}x${TARGET_HEIGHT}\n`);
  console.log(`🎨 背景色: #${BG_COLOR.r.toString(16)}${BG_COLOR.g.toString(16)}${BG_COLOR.b.toString(16)} (柔和深蓝灰)\n`);

  for (const item of screenshots) {
    await processImage(item.src, item.out, item.label);
  }

  console.log(`\n✨ 完成！\n`);
}

main();
