const fs = require('fs');
const path = require('path');

const DIR = 'c:\\Users\\QzCrane\\Desktop\\VolumeBooster\\reference';
const FILES = {
    hz: 'hz-rules-list.txt',
    ps: 'photoshow-rules-list.txt',
    im: 'imagus-rules-list.txt',
    index: 'unified-rules-index.txt'
};

// --- Normalization Logic (Must match generation logic EXACTLY or close enough) ---
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

// --- 1. Load Index ---
console.log('--- Loading unified-rules-index.txt ---');
const indexData = new Map(); // NormalizedKey -> { hz: bool, ps: Set(ids), im: Set(ids) }
try {
    const content = fs.readFileSync(path.join(DIR, FILES.index), 'utf8');
    const lines = content.split('\n').slice(1); // Skip header
    lines.forEach(l => {
        if (!l.trim()) return;
        const p = l.split(':');
        const key = p[0];
        const hz = p[1] === '√';
        const psIds = p[2] !== '#' ? p[2].split(',') : [];
        const imIds = p[3] !== '#' ? p[3].split(',') : [];
        
        indexData.set(key, { hz, ps: new Set(psIds), im: new Set(imIds) });
    });
    console.log(`Loaded ${indexData.size} index rows.`);
} catch(e) { console.error('Error loading index', e); process.exit(1); }


// --- 2. Verify HZ ---
console.log('\n--- Verifying HZ Rules ---');
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
            domains.push(colonMatch[1]);
            const inner = line.substring(colonMatch[0].length);
            const pipes = inner.split('|');
            pipes.forEach(p => {
                const d = p.split('(')[0].trim();
                // Fix: Ignore empty strings
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
            // Verify if norm exists in index with HZ checked
            const entry = indexData.get(norm);
            if (entry && entry.hz) {
                hzMatchedRules++;
            } else {
                hzMissingRules.push({ raw: d, norm: norm });
            }
        });
    });
} catch(e) { console.error(e); }

console.log(`HZ Source Entities: ${hzSourceCount}`);
console.log(`HZ Matches in Index: ${hzMatchedRules}`);
if (hzMissingRules.length > 0) {
    console.log(`! HZ MISSING RULES: ${hzMissingRules.length}`);
    console.log('Sample missing:', hzMissingRules.slice(0, 3));
} else {
    console.log('√ HZ Verification Passed (All source entities found in index)');
}


// --- 3. Verify PhotoShow ---
console.log('\n--- Verifying PhotoShow Rules ---');
let psSourceIds = new Set();
let psMissingInIndex = [];

try {
    const content = fs.readFileSync(path.join(DIR, FILES.ps), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        const match = line.match(/^(\d+)\s+(.*)/);
        if (match) {
            const id = match[1];
            const rawContent = match[2];
            // Split parts to simulate how many specific rules were generated
            const parts = rawContent.split('/');
            parts.forEach(p => {
                 // We rely on ID being present in Index for ANY key.
                 // Actually, if a PS line splits into 3 keys, we expect that ID to appear 3 times (or in 3 rows) in Index?
                 // Or at least ONCE in the index.
                 // A strict check is: For every split part, does it map to an index row with that ID?
                 let d = p.replace(/\(.*\)/g, '').trim(); 
                 if (!d) return;
                 const norm = normalize(d);
                 
                 const entry = indexData.get(norm);
                 if (entry && entry.ps.has(id)) {
                     // Found
                 } else {
                     psMissingInIndex.push({ id, raw: d, norm });
                 }
                 psSourceIds.add(id);
            });
        }
    });
} catch(e) { console.error(e); }

// Count unique PS IDs found in Index
let psIndexUniqueIds = new Set();
indexData.forEach(entry => {
    entry.ps.forEach(id => psIndexUniqueIds.add(id));
});

console.log(`PS Source Unique IDs: ${psSourceIds.size}`);
console.log(`PS Index Unique IDs: ${psIndexUniqueIds.size}`);

if (psMissingInIndex.length > 0) {
    console.log(`! PS Logic Mismatch: ${psMissingInIndex.length} domain parts not mapping correctly.`);
    console.log('Sample:', psMissingInIndex.slice(0, 3));
} else {
    console.log('√ PS Verification Passed (All source parts map to correct Index IDs)');
}


// --- 4. Verify Imagus ---
console.log('\n--- Verifying Imagus Rules ---');
let imSourceIds = new Set();
let imMissingInIndex = [];

try {
    const content = fs.readFileSync(path.join(DIR, FILES.im), 'utf8');
    content.split('\n').forEach(line => {
        if (!line.trim()) return;
        const regex = /(\d+)\s+([^\s|]+)/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
            const id = match[1];
            const raw = match[2];
            imSourceIds.add(id);
            
            const norm = normalize(raw);
            const entry = indexData.get(norm);
            if (entry && entry.im.has(id)) {
                // Found
            } else {
                imMissingInIndex.push({ id, raw, norm });
            }
        }
    });
} catch(e) { console.error(e); }

let imIndexUniqueIds = new Set();
indexData.forEach(entry => {
    entry.im.forEach(id => imIndexUniqueIds.add(id));
});

console.log(`Imagus Source Unique IDs: ${imSourceIds.size}`);
console.log(`Imagus Index Unique IDs: ${imIndexUniqueIds.size}`);

if (imMissingInIndex.length > 0) {
    console.log(`! Imagus Logic Mismatch: ${imMissingInIndex.length} keys not mapping correctly.`);
    console.log('Sample:', imMissingInIndex.slice(0, 3));
} else {
    console.log('√ Imagus Verification Passed');
}


// --- Loading unified-rules-index.txt ---
// Loaded 1193 index rows.

// --- Verifying HZ Rules ---
// HZ Source Entities: 413
// HZ Matches in Index: 413
// √ HZ Verification Passed (All source entities found in index)

// --- Verifying PhotoShow Rules ---
// PS Source Unique IDs: 143
// PS Index Unique IDs: 143
// √ PS Verification Passed (All source parts map to correct Index IDs)

// --- Verifying Imagus Rules ---
// Imagus Source Unique IDs: 823
// Imagus Index Unique IDs: 822
// ! Imagus Logic Mismatch: 2 keys not mapping correctly.
// Sample: [
//   { id: '2', raw: '[Google_Images]', norm: 'google_images' },
//   { id: '11', raw: '[data:image]', norm: 'data:image' }
// ]