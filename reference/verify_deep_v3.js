const fs = require('fs');
const path = require('path');

const DIR = 'D:\\Project\\VolumeBooster\\reference';
const FILES = {
    hz: 'hz-rules-list.txt',
    ps: 'photoshow-rules-list.txt',
    im: 'imagus-rules-list.txt',
    index: 'unified-rules-index.txt'
};

// --- Normalization Logic ---
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
    if (s === 'google_images') return 'google';
    return s.trim();
}

// Stats Counters
let stats = {
    totalUnique: 0,
    totalHZ: 0, 
    totalPS: 0,
    totalIM: 0,
    overlapHZ_PS: 0,
    overlapHZ_IM: 0,
    overlapPS_IM: 0,
    overlapAll: 0
};

// --- 1. Load Index & Verify Stats ---
console.log('--- Loading unified-rules-index.txt and Calculating Stats ---');
const indexData = new Map(); // NormalizedKey -> { hz: Count, ps: Set(ids), im: Set(ids) }

try {
    const content = fs.readFileSync(path.join(DIR, FILES.index), 'utf8');
    const lines = content.split('\n');
    let dataStart = 0;
    // Skip until header row is found
    for(let i=0; i<lines.length; i++) {
        if(lines[i].startsWith('Domain:HZ:')) {
            dataStart = i + 1;
            break;
        }
    }
    const dataLines = lines.slice(dataStart);
    
    dataLines.forEach(l => {
        if (!l.trim()) return;
        const p = l.split(':');
        
        let hzStr, psStr, imStr;
        if (p.length > 4) {
             imStr = p[p.length - 1];
             psStr = p[p.length - 2];
             hzStr = p[p.length - 3];
        } else {
             hzStr = p[1];
             psStr = p[2];
             imStr = p[3];
        }
        
        const normKey = p.slice(0, p.length - 3).join(':') || p[0];
        
        // Count HZ from the number in the cell (or '√' if old format, but current is number)
        let hzVal = 0;
        if (hzStr !== '#' && hzStr !== '') {
            // It might be a number now
            const n = parseInt(hzStr);
            hzVal = isNaN(n) ? 1 : n; 
        }
        
        const hasHZ = hzVal > 0;
        const hasPS = psStr !== '#';
        const hasIM = imStr !== '#';
        
        const psIds = hasPS ? psStr.split(',') : [];
        const imIds = hasIM ? imStr.split(',') : [];

        indexData.set(normKey, { hz: hzVal, ps: new Set(psIds), im: new Set(imIds) });
        
        // Update Stats
        stats.totalUnique++;
        stats.totalHZ += hzVal; 
        stats.totalPS += psIds.length;
        stats.totalIM += imIds.length;
        
        if (hasHZ && hasPS) stats.overlapHZ_PS++;
        if (hasHZ && hasIM) stats.overlapHZ_IM++;
        if (hasPS && hasIM) stats.overlapPS_IM++;
        
        if (hasHZ && hasPS && hasIM) stats.overlapAll++;
    });
    
    console.log(`Loaded ${indexData.size} index rows.`);

    // Print Stats
    console.log('\n--- Checking Rule Counts ---');
    console.log(`HZ Rules (Total Count): ${stats.totalHZ} (Expected ~396)`);
    console.log(`PhotoShow Rules: ${stats.totalPS}`);
    console.log(`Imagus Rules: ${stats.totalIM}`);

} catch(e) { console.error('Error loading index', e); process.exit(1); }


// --- 2. Verify HZ Source ---
console.log('\n--- Verifying HZ Source coverage ---');
let hzSourceCount = 0;
let hzMatchedRules = 0;
let hzMissingRules = [];

try {
    const content = fs.readFileSync(path.join(DIR, FILES.hz), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        let domains = [];
        const colonMatch = line.match(/^([^:]+):/);
        if (colonMatch) {
            // IGNORE Group headers for counting rules, only count content
            const inner = line.substring(colonMatch[0].length);
            const pipes = inner.split('|');
            pipes.forEach(p => {
                const d = p.split('(')[0].trim();
                if (d) domains.push(d);
            });
        } else {
            const braceMatch = line.match(/^([^(]+)\(/);
            if (braceMatch) domains.push(braceMatch[1].trim());
            else {
                const d = line.split('(')[0].trim();
                if(d) domains.push(d);
            }
        }
        
        domains.forEach(d => {
            hzSourceCount++;
            const norm = normalize(d);
            const entry = indexData.get(norm);
            if (entry && entry.hz > 0) {
                hzMatchedRules++;
            } else {
                hzMissingRules.push({ raw: d, norm: norm });
            }
        });
    });
} catch(e) { console.error(e); }

console.log(`HZ matched: ${hzMatchedRules} / ${hzSourceCount}`);
if (hzMissingRules.length > 0) console.log('HZ Missing:', hzMissingRules.slice(0,3));

// Note: HZ matched might be > stats.totalHZ if multiple source rules map to same index row 
// AND the index row count equals the sum of them. 
// Actually, iterate source -> check if index exists. This verifies coverage.
// To verify count exactness: Sum of indexData.hz should equal hzSourceCount.
let indexTotalHZ = 0;
indexData.forEach(v => indexTotalHZ += v.hz);
console.log(`Sum of HZ counts in Index: ${indexTotalHZ} (Should match Source Count: ${hzSourceCount})`);


// --- 3. Verify PhotoShow Source ---
console.log('\n--- Verifying PhotoShow Source coverage ---');
let psSourceCount = 0;
let psMatched = 0;
let psMissing = [];

try {
    const content = fs.readFileSync(path.join(DIR, FILES.ps), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        const match = line.match(/^(\d+)\s+(.*)/);
        if (match) {
            const id = match[1];
            const rawContent = match[2];
            const parts = rawContent.split('/');
            parts.forEach(p => {
                 let d = p.replace(/\(.*\)/g, '').trim(); 
                 if (!d) return;
                 psSourceCount++;
                 const norm = normalize(d);
                 
                 const entry = indexData.get(norm);
                 if (entry && entry.ps.has(id)) {
                     psMatched++;
                 } else {
                     psMissing.push({ id, raw: d, norm });
                 }
            });
        }
    });
} catch(e) { console.error(e); }
console.log(`PS matched: ${psMatched} / ${psSourceCount}`);
if (psMissing.length > 0) {
    console.log('PS Missing:', JSON.stringify(psMissing, null, 2));
}


// --- 4. Verify Imagus Source ---
console.log('\n--- Verifying Imagus Source coverage ---');
let imSourceCount = 0;
let imMatched = 0;
let imMissing = [];

try {
    const content = fs.readFileSync(path.join(DIR, FILES.im), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        const regex = /(\d+)\s+([^\s|]+)/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
            const id = match[1];
            const raw = match[2];
            imSourceCount++;
            
            const norm = normalize(raw);
            const entry = indexData.get(norm);
            if (entry && entry.im.has(id)) {
                imMatched++;
            } else {
                imMissing.push({ id, raw, norm });
            }
        }
    });
} catch(e) { console.error(e); }
console.log(`Imagus matched: ${imMatched} / ${imSourceCount}`);
if (imMissing.length > 0) {
    console.log('Imagus Missing:', JSON.stringify(imMissing, null, 2));
}

// --- Loading unified-rules-index.txt and Calculating Stats ---
// Loaded 1193 index rows.

// --- Checking Rule Counts ---
// HZ Rules (Total Count): 396 (Expected ~396)
// PhotoShow Rules: 168
// Imagus Rules: 822

// --- Verifying HZ Source coverage ---
// HZ matched: 396 / 396
// Sum of HZ counts in Index: 396 (Should match Source Count: 396)

// --- Verifying PhotoShow Source coverage ---
// PS matched: 168 / 168

// --- Verifying Imagus Source coverage ---
// Imagus matched: 822 / 823
// Imagus Missing: [
//   {
//     "id": "2",
//     "raw": "[Google_Images]",
//     "norm": "google"
//   }
// ]
