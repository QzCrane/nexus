const fs = require('fs');
const path = require('path');

const pluginsDir = 'hoverzoom-plus/plugins';
const files = fs.readdirSync(pluginsDir).filter(f => f.endsWith('.js'));

// 别名映射 (将变体名映射到主站点名)
const aliases = {
  'TWIMG': 'TWITTER',
  'MEDIA-AMAZON': 'AMAZON',
  'CLIPS.TWITCH': 'TWITCH', 
  'CLIPPITUSER': 'TWITCH',
  'RULE34VIDEO': 'RULE34',
  'YOU': 'YOUTUBE'  // you.js → YOUTUBE
};

// 按站点名分组
const siteMap = new Map();
files.forEach(file => {
  const stat = fs.statSync(path.join(pluginsDir, file));
  const sizeKB = (stat.size / 1024).toFixed(1) + 'K';
  const name = file.replace('.js', '');
  
  // 提取站点名: 去掉 _a 后缀
  let siteName = name.replace(/_a$/, '').toUpperCase();
  // 应用别名
  if (aliases[siteName]) siteName = aliases[siteName];
  
  if (!siteMap.has(siteName)) siteMap.set(siteName, []);
  siteMap.get(siteName).push(`${name}(${sizeKB})`);
});

// 输出
const output = [];
for (const [site, rules] of siteMap) {
  if (rules.length === 1) {
    output.push(rules[0]);
  } else {
    output.push(`${site}: ${rules.join(' | ')}`);
  }
}

fs.writeFileSync('hz-rules-list.txt', output.join('\n'));
console.log('Done:', siteMap.size, 'sites,', files.length, 'plugins');
