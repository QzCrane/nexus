import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOOLS_DIR = path.resolve(__dirname, '../apps/extension-halo/src/tools');

const updates = {
    'archive': ["pageCapture", "downloads"],
    'userscripts': ["webNavigation", "*://*/*"],
    'clipboard': ["clipboardRead", "clipboardWrite"],
    'qrcode': ["clipboardWrite"],
    'color-picker': ["clipboardWrite"],
    'pdf': ["downloads"]
};

for (const [id, permissions] of Object.entries(updates)) {
    const manifestPath = path.join(TOOLS_DIR, id, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
        const content = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        content.permissions = permissions;
        fs.writeFileSync(manifestPath, JSON.stringify(content, null, '\t') + '\n');
        console.log(`Updated ${id}`);
    } else {
        console.warn(`Missing tool ${id}`);
    }
}
