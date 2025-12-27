import sharp from 'sharp';

// 舒适的深色背景
const BG = { r: 30, g: 30, b: 46 };

async function createTiles() {
  // 小型宣传图 440x280
  await sharp({
    create: { width: 440, height: 280, channels: 3, background: BG }
  })
    .composite([{
      input: await sharp('./store/small-tile-440x280.png')
        .resize(440, 280, { fit: 'cover' })
        .flatten({ background: BG })
        .toBuffer(),
      left: 0, top: 0
    }])
    .removeAlpha()
    .png()
    .toFile('./store/small-tile-440x280-fixed.png');
  
  console.log('✅ 小型宣传图: 440x280');

  // 顶部大图 1400x560
  await sharp({
    create: { width: 1400, height: 560, channels: 3, background: BG }
  })
    .composite([{
      input: await sharp('./store/marquee-1400x560.png')
        .resize(1400, 560, { fit: 'cover' })
        .flatten({ background: BG })
        .toBuffer(),
      left: 0, top: 0
    }])
    .removeAlpha()
    .png()
    .toFile('./store/marquee-1400x560-fixed.png');

  console.log('✅ 顶部大图: 1400x560');
  console.log('\n✨ 完成！请用 -fixed 文件上传');
}

createTiles();
