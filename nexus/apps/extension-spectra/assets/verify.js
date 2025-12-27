import fs from 'fs';

const files = [
  { path: './store/small-tile-440x280.png', expected: '440x280' },
  { path: './store/marquee-1400x560.png', expected: '1400x560' }
];

files.forEach(({ path, expected }) => {
  const buf = fs.readFileSync(path);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const colorType = buf[25];
  const hasAlpha = colorType === 4 || colorType === 6;
  const sizeOk = `${w}x${h}` === expected;
  console.log(`${path.split('/').pop()}: ${w}x${h} | Alpha: ${hasAlpha ? '❌YES' : '✅NO'} | ${sizeOk ? '✅' : '❌'}`);
});
