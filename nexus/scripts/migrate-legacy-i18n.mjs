import fs from 'fs';
import path from 'path';

// Config
const ROOT = process.cwd();
const HALO_ROOT = path.join(ROOT, 'apps/extension-halo/src');
const MODULES_EN = path.join(HALO_ROOT, 'i18n/locales/en-modules/modules.ts');
const MODULES_ZH = path.join(HALO_ROOT, 'i18n/locales/zh-modules/modules.ts');

function parseLegacyModules(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const tools = {};
    // Match: key: { name: '...', desc: '...' }
    // Handles simple single-quoted strings.
    const regex = /^\s*['"]?([\w-]+)['"]?:\s*\{\s*name:\s*['"]([^'"]+)['"],\s*desc:\s*['"]([^'"]+)['"],/gm;
    let match;
    while ((match = regex.exec(content)) !== null) {
        tools[match[1]] = { name: match[2], desc: match[3] };
    }
    return tools;
}

function updateLocaleFile(filePath, toolId, data) {
    let content = '';
    if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf8');
    } else {
        // Create new file if not exists
        const lang = filePath.endsWith('en.ts') ? 'en' : 'zh';
        content = `export const ${lang} = {\n};`;
    }
    
    const keyName = `tools.${toolId}.name`;
    const keyDesc = `tools.${toolId}.desc`;
    
    // Simple check
    if (content.includes(`'${keyName}'`)) {
        // console.log(`Skipping ${toolId} (keys exist in ${filePath})`);
        return;
    }
    
    const insertion = `\n\t'${keyName}': '${data.name}',\n\t'${keyDesc}': '${data.desc}',`;
    
    // Find injection point: after "export const xx = {"
    const match = /export const \w+ = \{/.exec(content);
    if (match) {
        const idx = match.index + match[0].length;
        const newContent = content.slice(0, idx) + insertion + content.slice(idx);
        fs.writeFileSync(filePath, newContent, 'utf8');
        // console.log(`Updated ${filePath}`);
    } else {
        console.warn(`Could not parse ${filePath}`);
    }
}

function run() {
    console.log('Parsing legacy modules...');
    const enData = parseLegacyModules(MODULES_EN);
    const zhData = parseLegacyModules(MODULES_ZH);
    
    console.log(`EN tools: ${Object.keys(enData).length}`);
    console.log(`ZH tools: ${Object.keys(zhData).length}`);
    
    const allIds = new Set([...Object.keys(enData), ...Object.keys(zhData)]);
    
    console.log(`Found ${allIds.size} tools to migrate.`);
    
    let migratedCount = 0;
    for (const toolId of allIds) {
        let toolDir = path.join(HALO_ROOT, 'tools', toolId);
        if (!fs.existsSync(toolDir)) toolDir = path.join(HALO_ROOT, 'system', toolId);
        
        if (!fs.existsSync(toolDir)) {
            // console.warn(`Directory not found for ${toolId}`);
            continue;
        }
        
        const localesDir = path.join(toolDir, 'locales');
        if (!fs.existsSync(localesDir)) fs.mkdirSync(localesDir, { recursive: true });
        
        if (enData[toolId]) updateLocaleFile(path.join(localesDir, 'en.ts'), toolId, enData[toolId]);
        if (zhData[toolId]) updateLocaleFile(path.join(localesDir, 'zh.ts'), toolId, zhData[toolId]);
        migratedCount++;
    }
    console.log(`Migration complete. Processed ${migratedCount} tools.`);
}

run();
