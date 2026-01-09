const fs = require('fs');
const path = require('path');

const DIR = 'c:\\Users\\QzCrane\\Desktop\\VolumeBooster\\reference';
const files = {
    hz: { name: 'hz-rules-list.txt' },
    ps: { name: 'photoshow-rules-list.txt' },
    im: { name: 'imagus-rules-list.txt' }
};

const map = new Map(); // Key -> { hz: Set(val), ps: Set(val), im: Set(val) }

function setVal(key, source, val) {
    if (!key) return;
    const normalizedKey = normalize(key);
    if (!normalizedKey) return;
    
    if (!map.has(normalizedKey)) {
        map.set(normalizedKey, { hz: new Set(), ps: new Set(), im: new Set() });
    }
    map.get(normalizedKey)[source].add(val);
}

function normalize(str) {
    if (!str) return '';
    let s = str.trim().toLowerCase();
    
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
    
    // Clean up
    s = s.replace(/[-_\.]+$/, '');

    // Common normalization
    if (s === 'x') return 'x';
    
    // Specific fix examples based on previous output
    if (s === 'google_images') return 'google'; // Merge google variations? 
    // User requested "按域名的字典序", distinct keys are fine, but grouping is better.
    // However, risk of over-merging. Let's stick to base normalization.
    // Maybe remove specific sub-keys if they are just services.
    // e.g. "google_drive" -> "google"? "ali_express" -> "aliexpress"?
    // For now, keep as is unless suffixes like _video are standard.
    
    return s.trim();
}

// 1. Process HZ - File based, so value is '√'
try {
    const content = fs.readFileSync(path.join(DIR, files.hz.name), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        // Format: "AMAZON: amazon(1.3K) | media-amazon_a(0.8K)"
        // or "500px(9.9K)"
        
        let domains = [];
        const colonMatch = line.match(/^([^:]+):/);
        if (colonMatch) {
            domains.push(colonMatch[1]); // The group name itself
            const inner = line.substring(colonMatch[0].length);
            const pipes = inner.split('|');
            pipes.forEach(p => {
                const d = p.split('(')[0].trim();
                if(d) domains.push(d);
            });
        } else {
            const braceMatch = line.match(/^([^(]+)\(/);
            if (braceMatch) domains.push(braceMatch[1].trim());
            else {
                 const d = line.split('(')[0].trim();
                 if(d) domains.push(d);
            }
        }
        
        domains.forEach(d => setVal(d, 'hz', '√'));
    });
} catch (e) { console.error('Error HZ', e); }

// 2. Process PhotoShow - Line number is first token
try {
    const content = fs.readFileSync(path.join(DIR, files.ps.name), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        // "336 115.com"
        // "486 acfun.cn / kuaishou.com"
        const match = line.match(/^(\d+)\s+(.*)/);
        if (match) {
            const id = match[1];
            const rawContent = match[2];
            const parts = rawContent.split('/');
            parts.forEach(p => {
                let d = p.replace(/\(.*\)/g, '').trim(); 
                if(d) setVal(d, 'ps', id);
            });
        }
    });
} catch (e) { console.error('Error PS', e); }

// 3. Process Imagus - Line number embedded
try {
    const content = fs.readFileSync(path.join(DIR, files.im.name), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        // Regex to find "ID Key" pairs
        // e.g. "187 ALIEXPRESS-s" or "2 [Google]"
        // Beware of "3843 shottr-h"
        
        // We iterate over all matches in the line
        const regex = /(\d+)\s+([^\s|]+)/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
            const id = match[1];
            const key = match[2];
            setVal(key, 'im', id);
        }
    });
} catch (e) { console.error('Error Imagus', e); }

// Output
const sortedKeys = Array.from(map.keys()).sort();
const output = [];

output.push('Domain:HZ:PhotoShow:Imagus');

sortedKeys.forEach(key => {
    if (!key) return; 
    const data = map.get(key);
    
    const hz = data.hz.size > 0 ? Array.from(data.hz).join(',') : '#';
    const ps = data.ps.size > 0 ? Array.from(data.ps).sort((a,b)=>Number(a)-Number(b)).join(',') : '#';
    const im = data.im.size > 0 ? Array.from(data.im).sort((a,b)=>Number(a)-Number(b)).join(',') : '#';
    
    // Special handling as per user req: "Domain:HZ:PhotoShow:Imagus"
    // "500px:√:3:18" (example)
    
    output.push(`${key}:${hz}:${ps}:${im}`);
});

fs.writeFileSync(path.join(DIR, 'unified-rules-index.txt'), output.join('\n'));
console.log(`Generated unified index for ${sortedKeys.length} domains.`);
