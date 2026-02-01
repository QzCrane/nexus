const fs = require('fs');
const path = require('path');

const DIR = 'D:\\Project\\Nexus\\reference';
const files = {
    hz: { name: 'hz-rules-list.txt' },
    ps: { name: 'photoshow-rules-list.txt' },
    im: { name: 'imagus-rules-list.txt' }
};

const map = new Map(); // Key -> { hz: Count, ps: Set(ids), im: Set(ids) }

function addRule(key, source, val) {
    if (!key) return;
    const normalizedKey = normalize(key);
    if (!normalizedKey) return;

    if (!map.has(normalizedKey)) {
        map.set(normalizedKey, { hz: 0, ps: new Set(), im: new Set() });
    }

    if (source === 'hz') {
        map.get(normalizedKey).hz += 1;
    } else {
        map.get(normalizedKey)[source].add(val);
    }
}

function normalize(str) {
    if (!str) return '';
    let s = str.trim().toLowerCase();

    s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
    s = s.replace(/[\[\]]/g, '');

    const tlds = [
        'com', 'net', 'org', 'cn', 'ru', 'co\\.uk', 'jp', 'tv', 'io', 'cc', 'me',
        'de', 'pl', 'fr', 'kr', 'au', 'nz', 'tw', 'vn', 'us', 'ir', 'gr', 'info',
        'biz', 'eu', 'ua', 'cz', 'hu', 'ro', 'sk', 'no', 'fi', 'dk', 'se', 'nl',
        'be', 'at', 'ch', 'es', 'pt', 'it', 'ca', 'br', 'mx', 'cl', 'ar', 'pe',
        'co', 've', 'id', 'my', 'ph', 'sg', 'th', 'in', 'pk', 'bd', 'sa', 'ae',
        'eg', 'za', 'ng', 'ke', 'su', 'hk', 'site', 'xyz', 'top', 'online'
    ];
    const tldRegex = new RegExp(`\\.(${tlds.join('|')})(?=\\/|$|\\s|\\)|_|-|:|\\[|\\])`, 'g');
    s = s.replace(tldRegex, '');

    s = s.replace(/_a$/, '');
    s = s.replace(/(?:-[sgxphqmbv]+)+$/, '');
    s = s.replace(/-cdn$/, '');
    s = s.replace(/_cdn$/, '');
    s = s.replace(/[-_\.]+$/, '');

    if (s === 'x') return 'x';
    return s.trim();
}

// 1. Process HZ - Count rules per normalized key
try {
    const content = fs.readFileSync(path.join(DIR, files.hz.name), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;

        let domains = [];
        const colonMatch = line.match(/^([^:]+):/);

        if (colonMatch) {
            // IGNORE the group name for counting! Only count content files.
            // domains.push(colonMatch[1]); <-- DELETE THIS

            const inner = line.substring(colonMatch[0].length);
            const pipes = inner.split('|');
            pipes.forEach(p => {
                const d = p.split('(')[0].trim();
                // Ensure we only count real files (simple validation)
                if (d) domains.push(d);
            });
        } else {
            const braceMatch = line.match(/^([^(]+)\(/);
            if (braceMatch) domains.push(braceMatch[1].trim());
            else {
                const d = line.split('(')[0].trim();
                if (d) domains.push(d);
            }
        }

        domains.forEach(d => addRule(d, 'hz', 1));
    });
} catch (e) { console.error('Error HZ', e); }

// 2. Process PhotoShow
try {
    const content = fs.readFileSync(path.join(DIR, files.ps.name), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        const match = line.match(/^(\d+)\s+(.*)/);
        if (match) {
            const id = match[1];
            const rawContent = match[2];
            const parts = rawContent.split('/');
            parts.forEach(p => {
                let d = p.replace(/\(.*\)/g, '').trim();
                if (d) addRule(d, 'ps', id);
            });
        }
    });
} catch (e) { console.error('Error PS', e); }

// 3. Process Imagus
try {
    const content = fs.readFileSync(path.join(DIR, files.im.name), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        const regex = /(\d+)\s+([^\s|]+)/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
            const id = match[1];
            const key = match[2];
            addRule(key, 'im', id);
        }
    });
} catch (e) { console.error('Error Imagus', e); }

// Output
const sortedKeys = Array.from(map.keys()).sort();
const output = [];

// Header with descriptions as requested previously (optional, keeping clean mostly)
output.push('## 1. Hover Zoom+ (Hz+): `reference/hoverzoom-plus/plugins/`');
output.push('## 2. PhotoShow: `reference/photoshow/source/background.js`');
output.push('## 3. Imagus-Reborn: `reference/imagus-reborn/src/data/sieve.json`');
output.push('');
output.push('Domain:HZ:PhotoShow:Imagus');

let hzTotalCheck = 0;

sortedKeys.forEach(key => {
    if (!key) return;
    const data = map.get(key);

    // HZ: show count if > 0, else #
    const hzStr = data.hz > 0 ? String(data.hz) : '#';
    hzTotalCheck += data.hz;

    const ps = data.ps.size > 0 ? Array.from(data.ps).sort((a, b) => Number(a) - Number(b)).join(',') : '#';
    const im = data.im.size > 0 ? Array.from(data.im).sort((a, b) => Number(a) - Number(b)).join(',') : '#';

    output.push(`${key}:${hzStr}:${ps}:${im}`);
});

fs.writeFileSync(path.join(DIR, 'unified-rules-index.txt'), output.join('\n'));
console.log(`Generated unified index for ${sortedKeys.length} domains.`);
console.log(`Total HZ Rules Counted: ${hzTotalCheck}`); // Should be 396
