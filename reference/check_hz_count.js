const fs = require('fs');
const path = require('path');

const DIR = 'c:\\Users\\QzCrane\\Desktop\\VolumeBooster\\reference';
const PLUGIN_DIR = path.join(DIR, 'hoverzoom-plus', 'plugins');

// 1. Get Physical Files
let files = [];
try {
    files = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.js'));
} catch (e) {
    console.error('Error reading plugins dir', e);
}
console.log(`Physical Files: ${files.length}`);

// 2. Get Rule List Entities
let ruleEntities = new Set();
try {
    const content = fs.readFileSync(path.join(DIR, 'hz-rules-list.txt'), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        let domains = [];
        const colonMatch = line.match(/^([^:]+):/);
        if (colonMatch) {
            // Group header "AMAZON:" is usually a virtual group name, NOT a file?
            // But let's check content inside.
            const inner = line.substring(colonMatch[0].length);
            const pipes = inner.split('|');
            pipes.forEach(p => {
                const d = p.split('(')[0].trim();
                if (d) ruleEntities.add(d);
            });
        } else {
            const braceMatch = line.match(/^([^(]+)\(/);
            if (braceMatch) ruleEntities.add(braceMatch[1].trim());
            else {
                const d = line.split('(')[0].trim();
                if(d) ruleEntities.add(d);
            }
        }
    });
} catch (e) { console.error(e); }

console.log(`Entities in hz-rules-list.txt: ${ruleEntities.size}`);

// 3. Compare
const fileSet = new Set(files.map(f => f.replace('.js', '')));
const diffFiles = [...fileSet].filter(x => !ruleEntities.has(x));
const diffRules = [...ruleEntities].filter(x => !fileSet.has(x));

console.log(`Files not in Rule List: ${diffFiles.length}`);
if (diffFiles.length > 0) console.log(diffFiles);

console.log(`Rules not in File List: ${diffRules.length}`);
if (diffRules.length > 0) console.log(diffRules.sort());

// 4. Index Normalization Stats
const normMap = new Map();
ruleEntities.forEach(r => {
    // strict normalize from verified_deep logic
    let s = r.trim().toLowerCase();
    s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
    s = s.replace(/^\[/, '').replace(/\]$/, '');
     const tlds = [
        'com', 'net', 'org', 'cn', 'ru', 'co\\.uk', 'jp', 'tv', 'io', 'cc', 'me', 
        'de', 'pl', 'fr', 'kr', 'au', 'nz', 'tw', 'vn', 'us', 'ir', 'gr', 'info', 
        'biz', 'eu', 'ua', 'cz', 'hu', 'ro', 'sk', 'no', 'fi', 'dk', 'se', 'nl', 
        'be', 'at', 'ch', 'es', 'pt', 'it', 'ca', 'br', 'mx', 'cl', 'ar', 'pe', 
        'co', 've', 'id', 'my', 'ph', 'sg', 'th', 'in', 'pk', 'bd', 'sa', 'ae', 
        'eg', 'za', 'ng', 'ke', 'su', 'hk', 'site', 'xyz', 'top', 'online'
    ];
    // Use lookahead to safely remove TLDs
    const tldRegex = new RegExp(`\\.(${tlds.join('|')})(?=\\/|$|\\s|\\)|_|-|:|\\[|\\])`, 'g');
    s = s.replace(tldRegex, '');
    
    // Remove suffixes
    s = s.replace(/_a$/, '');
    s = s.replace(/(?:-[sgxphqmbv]+)+$/, '');
    s = s.replace(/-cdn$/, '');
    s = s.replace(/_cdn$/, ''); 
    s = s.replace(/[-_\.]+$/, '');
    if (s === 'x') s = 'x';
    
    if (!normMap.has(s)) normMap.set(s, []);
    normMap.get(s).push(r);
});

console.log(`Normalized Keys: ${normMap.size}`);
console.log('Merged examples:');
let mergedCount = 0;
normMap.forEach((v, k) => {
    if (v.length > 1) {
        mergedCount++;
        if (mergedCount <= 5) console.log(`  ${k}: [${v.join(', ')}]`);
    }
});
console.log(`Total merged groups: ${mergedCount}`);
