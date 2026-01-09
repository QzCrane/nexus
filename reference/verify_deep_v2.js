const fs = require('fs');
const path = require('path');

const DIR = 'c:\\Users\\QzCrane\\Desktop\\VolumeBooster\\reference';
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
const indexData = new Map(); // NormalizedKey -> { hz: bool, ps: Set(ids), im: Set(ids) }

try {
    const content = fs.readFileSync(path.join(DIR, FILES.index), 'utf8');
    const lines = content.split('\n').slice(1); // Skip header
    
    lines.forEach(l => {
        if (!l.trim()) return;
        const p = l.split(':');
        // Handle "data:image" split issue (length > 4)
        // If length > 4, we assume split error on key. 
        // But for statistics, we just need to detect HZ/PS/IM presence.
        // HZ is col 1, PS is col 2, IM is col 3.
        // If split on ':', we might have extra cols.
        // Re-assemble based on knowledge that last 3 are IM, PS, HZ... wait.
        // Format: Key:HZ:PS:IM
        // If Key has colon, e.g. "data:image", it becomes "data", "image", "HZ", "PS", "IM" -> Length 5
        // So we take from the END.
        
        let hzStr, psStr, imStr;
        
        if (p.length > 4) {
             imStr = p[p.length - 1];
             psStr = p[p.length - 2];
             hzStr = p[p.length - 3];
             // Key is everything else joined back
             // let key = p.slice(0, p.length - 3).join(':'); 
        } else {
             hzStr = p[1];
             psStr = p[2];
             imStr = p[3];
        }

        const normKey = p.slice(0, p.length - 3).join(':') || p[0];
        // Note: For verify logic below, simple split might fail for 'data:image' if we don't normalize similarly.
        // But let's trust simple split for stats now.
        
        const hasHZ = hzStr !== '#';
        const hasPS = psStr !== '#';
        const hasIM = imStr !== '#';
        
        const psIds = hasPS ? psStr.split(',') : [];
        const imIds = hasIM ? imStr.split(',') : [];

        indexData.set(normKey, { hz: hasHZ, ps: new Set(psIds), im: new Set(imIds) });
        
        // Update Stats
        stats.totalUnique++;
        if (hasHZ) stats.totalHZ++;
        if (hasPS) stats.totalPS++;
        if (hasIM) stats.totalIM++;
        
        if (hasHZ && hasPS) stats.overlapHZ_PS++;
        if (hasHZ && hasIM) stats.overlapHZ_IM++;
        if (hasPS && hasIM) stats.overlapPS_IM++;
        
        if (hasHZ && hasPS && hasIM) stats.overlapAll++;
    });
    
    console.log(`Loaded ${indexData.size} index rows.`);

    // Print Stats
    console.log('\n--- Statistics (Calculated during Index Load) ---');
    console.log(`Total Unique Domains: ${stats.totalUnique}`);
    console.log(`HZ Rules: ${stats.totalHZ}`);
    console.log(`PhotoShow Rules: ${stats.totalPS}`);
    console.log(`Imagus Rules: ${stats.totalIM}`);
    console.log(`HZ & PhotoShow: ${stats.overlapHZ_PS}`);
    console.log(`HZ & Imagus: ${stats.overlapHZ_IM}`);
    console.log(`PhotoShow & Imagus: ${stats.overlapPS_IM}`);
    console.log(`All Three: ${stats.overlapAll}`);
    
    // Check Math
    const union = stats.totalHZ + stats.totalPS + stats.totalIM 
                  - (stats.overlapHZ_PS + stats.overlapHZ_IM + stats.overlapPS_IM) 
                  + stats.overlapAll;
    console.log(`Verification (Set Theory): ${union} (Should be ${stats.totalUnique}) -> ${union === stats.totalUnique ? 'MATCH' : 'FAIL'}`);

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
            domains.push(colonMatch[1]);
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
            // Verify if norm exists in index with HZ checked
            const entry = indexData.get(norm);
            if (entry && entry.hz) {
                hzMatchedRules++;
            } else {
                 // Try to see if it exists at all
                 if (indexData.has(norm)) {
                     // logic error in generation?
                 }
                hzMissingRules.push({ raw: d, norm: norm });
            }
        });
    });
} catch(e) { console.error(e); }

console.log(`HZ matched: ${hzMatchedRules} / ${hzSourceCount}`);
if (hzMissingRules.length > 0) console.log('HZ Missing:', hzMissingRules.slice(0,3));


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
                     psMissing.push({id, raw:d, norm});
                 }
            });
        }
    });
} catch(e) { console.error(e); }

console.log(`PS matched: ${psMatched} / ${psSourceCount}`);
if(psMissing.length > 0) console.log('PS Missing:', psMissing.slice(0,3));


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
            // Handle special data:image case logic if needed
            // The split logic in stats loading might have handled data:image correctly or incorrectly depending on if norm resolves.
            // data:image normalized is "data:image"
            // If Index Key was "data:image", we need to check if we loaded it correctly.
            
            if (entry && entry.im.has(id)) {
                imMatched++;
            } else {
                imMissing.push({ id, raw, norm });
            }
        }
    });
} catch(e) { console.error(e); }

console.log(`Imagus matched: ${imMatched} / ${imSourceCount}`);
if(imMissing.length > 0) console.log('Imagus Missing:', imMissing.slice(0,3));



// --- Loading unified-rules-index.txt and Calculating Stats ---
// Loaded 1193 index rows.

// --- Statistics (Calculated during Index Load) ---    
// Total Unique Domains: 1193
// HZ Rules: 383
// PhotoShow Rules: 168
// Imagus Rules: 822
// HZ & PhotoShow: 42
// HZ & Imagus: 126
// PhotoShow & Imagus: 42
// All Three: 30
// Verification (Set Theory): 1193 (Should be 1193) -> MATCH

// --- Verifying HZ Source coverage ---
// HZ matched: 413 / 413

// --- Verifying PhotoShow Source coverage ---
// PS matched: 168 / 168

// --- Verifying Imagus Source coverage ---
// Imagus matched: 823 / 823