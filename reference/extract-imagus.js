const fs = require('fs');
const data = fs.readFileSync('imagus-reborn/src/data/sieve.json', 'utf8');
const lines = data.split(/\r?\n/);
const siteMap = new Map();

lines.forEach((line, i) => {
  const m = line.match(/^    "([^"]+)": \{/);
  if (!m) return;
  const ruleName = m[1];
  const lineNum = i + 1;
  
  // 提取站点名
  let siteName = ruleName;
  if (!siteName.startsWith('[')) {
    // 1. 去掉域名后缀 (.io, .KR, .COM, .ru 等)
    siteName = siteName.replace(/\.[a-z]{2,3}(?=[_-]|$)/gi, '');
    // 2. 提取主名称: 取 _ 或 - 前的部分作为站点名
    siteName = siteName.split(/[_-]/)[0];
    // 3. 处理 | 分隔的多站点，取第一个
    siteName = siteName.split('|')[0];
    siteName = siteName.toUpperCase();
    // 4. 别名映射
    const aliases = { 'FLIC': 'FLICKR', 'REDDTASTIC': 'REDDIT', 'REDDXXX': 'REDDIT' };
    if (aliases[siteName]) siteName = aliases[siteName];
  }
  
  if (!siteMap.has(siteName)) siteMap.set(siteName, []);
  siteMap.get(siteName).push(`${lineNum} ${ruleName}`);
});

// 输出：按站点合并
const output = [];
for (const [site, rules] of siteMap) {
  if (rules.length === 1) {
    output.push(rules[0]);
  } else {
    output.push(`${site}: ${rules.join(' | ')}`);
  }
}
fs.writeFileSync('imagus-rules-list.txt', output.join('\n'));
console.log('Done:', siteMap.size, 'sites,', lines.filter(l => /^    "/.test(l)).length, 'rules');
