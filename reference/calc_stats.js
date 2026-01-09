const fs = require('fs');
const path = require('path');

const filePath = 'c:\\Users\\QzCrane\\Desktop\\VolumeBooster\\reference\\unified-rules-index.txt';

try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim() !== '');
    
    // Counters
    let totalHZ = 0;
    let totalPS = 0;
    let totalIM = 0;
    
    let overlapHZ_PS = 0;
    let overlapHZ_IM = 0;
    let overlapPS_IM = 0;
    
    let overlapAll = 0;
    let totalUnique = 0;

    // Skip header
    const dataLines = lines.slice(1);
    
    dataLines.forEach(line => {
        const parts = line.split(':');
        if (parts.length < 4) return;
        
        const hzStr = parts[1];
        const psStr = parts[2];
        const imStr = parts[3];
        
        const hasHZ = hzStr !== '#';
        const hasPS = psStr !== '#';
        const hasIM = imStr !== '#';
        
        totalUnique++;
        
        if (hasHZ) totalHZ++;
        if (hasPS) totalPS++;
        if (hasIM) totalIM++;
        
        if (hasHZ && hasPS) overlapHZ_PS++;
        if (hasHZ && hasIM) overlapHZ_IM++;
        if (hasPS && hasIM) overlapPS_IM++;
        
        if (hasHZ && hasPS && hasIM) overlapAll++;
    });

    console.log('--- Statistics ---');
    console.log(`Total Unique Domains (Rows): ${totalUnique}`);
    console.log(`HZ Rules: ${totalHZ}`);
    console.log(`PhotoShow Rules: ${totalPS}`);
    console.log(`Imagus Rules: ${totalIM}`);
    console.log('');
    console.log('--- Overlaps ---');
    console.log(`HZ & PhotoShow: ${overlapHZ_PS}`);
    console.log(`HZ & Imagus: ${overlapHZ_IM}`);
    console.log(`PhotoShow & Imagus: ${overlapPS_IM}`);
    console.log(`All Three (HZ & PS & IM): ${overlapAll}`);
    console.log('');
    
    // Verification
    // Union = A + B + C - (AB + AC + BC) + ABC
    const calculatedUnion = totalHZ + totalPS + totalIM 
                            - (overlapHZ_PS + overlapHZ_IM + overlapPS_IM) 
                            + overlapAll;
                            
    console.log('--- Verification (Inclusion-Exclusion Principle) ---');
    console.log(`Calculated Union: ${calculatedUnion}`);
    console.log(`Actual Unique Lines: ${totalUnique}`);
    console.log(`Match: ${calculatedUnion === totalUnique ? 'YES' : 'NO'}`);

} catch (e) {
    console.error('Error reading file:', e);
}
