
import fs from 'fs';
import path from 'path';

// Define paths
const ROOT = path.resolve('c:/Users/QzCrane/Desktop/VolumeBooster/nexus/apps/extension-halo/src');
const I18N_DIR = path.join(ROOT, 'i18n/locales');
const TOOLS_DIR = path.join(ROOT, 'tools');

// Modules to scan
const MODULES = [
	'panels-core',
	'panels-dev',
	'panels-extra',
	'panels-v6',
	'panels-v7'
];

function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Helper to manually parse the object structure from the TS file
// This is a simplified parser assuming the standard export format
function parseModuleFile(content: string): Record<string, any> {
	try {
		// Regex to match "export const [name] = { ... }" and capture the inner content
		const match = content.match(/export const \w+ = ({[\s\S]*});/);
		if (!match) return {};

		// We use eval here because the content is trusted code from the project
		// and we need to parse the object literal potentially containing string keys
		// However, standard JSON.parse won't work on TS/JS object literals (keys without quotes)
		// A safer way is to use Function constructor
		const obj = new Function(`return ${match[1]}`)();
		return obj;
	} catch (e) {
		console.error('Failed to parse module content', e);
		return {};
	}
}

// Convert object back to nice typescript string
function toTS(obj: any): string {
	const json = JSON.stringify(obj, null, '\t');
	// Remove quotes from keys where possible to make it look like idiomatic TS
	return json.replace(/"(\w+)":/g, '$1:').replace(/"/g, "'");
}

function processLang(lang: 'en' | 'zh') {
	const modulesDir = path.join(I18N_DIR, `${lang}-modules`);

	MODULES.forEach(modName => {
		const filePath = path.join(modulesDir, `${modName}.ts`);
		if (!fs.existsSync(filePath)) return;

		console.log(`Processing ${lang}/${modName}...`);
		const content = fs.readFileSync(filePath, 'utf-8');
		const data = parseModuleFile(content);

		// Iterate over keys (which should be tool IDs or mapped IDs)
		// Note: The keys in the files (e.g., 'qrcodePanel') might not exactly match directory tool IDs ('qrcode')
		// We need a mapping strategy.
		// Heuristic: Remove 'Panel' suffix to guess directory name.

		Object.keys(data).forEach(key => {
			let toolId = key;
			if (toolId.endsWith('Panel')) {
				toolId = toolId.replace(/Panel$/, '');
			}

			// Special cases mapping if needed
			if (toolId === 'color') toolId = 'color-palette'; // or color-picker?
			if (toolId === 'json') toolId = 'json-formatter';

			// Check if directory exists
			// Try explicit tool ID first, then kebab-case
			let targetDir = path.join(TOOLS_DIR, toolId);
			if (!fs.existsSync(targetDir)) {
				// Try kebab case conversion (camelCase -> kebab-case)
				const kebab = toolId.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
				targetDir = path.join(TOOLS_DIR, kebab);
			}

			// Verify mapping
			// Check specifically for known mismatches based on directory list
			// qrcodePanel -> qrcode
			// colorPanel -> color-picker (or color-palette)
			// rulerPanel -> ruler
			// jsonPanel -> json-formatter
			// outlinePanel -> outline
			// clipboardPanel -> clipboard
			// regex -> regex
			// base64 -> base64
			// hash -> hash
			// uuid -> uuid
			// timestamp -> timestamp
			// url -> url
			// crypto -> crypto
			// mockData -> mock-data
			// network -> network

			// Let's refine targetDir based on the keys we saw in 'panels-dev' and 'panels-core'
			const keyMap: Record<string, string> = {
				'qrcodePanel': 'qrcode',
				'colorPanel': 'color-picker', // Assumption
				'rulerPanel': 'ruler',
				'jsonPanel': 'json-formatter',
				'outlinePanel': 'outline',
				'clipboardPanel': 'clipboard',
				'mockData': 'mock-data'
			};

			const computedId = keyMap[key] || toolId.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
			const toolDir = path.join(TOOLS_DIR, computedId);

			if (fs.existsSync(toolDir)) {
				// Determine file path
				const locDir = path.join(toolDir, 'locales');
				ensureDir(locDir);
				const locFile = path.join(locDir, `${lang}.ts`);

				// Prepare content
				// We wrap it in { tools: { [id]: ... } } to match the structure expected by the generator
				// The generator expects: export const en = { tools: { 'tool-id': { ... } } }

				// Wait, the key in the original file (e.g., 'qrcodePanel') might be used in t('qrcodePanel.xxx').
				// If we change it to 'qrcode', we break existing t() calls unless we update calls too?
				// The user only asked to move resources. 
				// However, the new system uses the directory name (tool ID) as the key?
				// The generator script says: 
				// const variable = t.id.replace(/-/g, '_');
				// export const TOOLS_EN = { ...variable }
				// And variable is imported from the file.
				// If the file exports { tools: { 'uuid': ... } }, then TOOLS_EN will have { tools: { 'uuid': ... } }.
				// This merges into the global 'en' object.
				// So the keys in the new system will be 'tools.uuid.xxx'.
				// The OLD keys were e.g., 'qrcodePanel.placeholder'.
				// If we move to 'tools.qrcode.placeholder', WE BREAK THE UI CALLS.

				// CRITICAL: We must checking if we can preserve the old keys OR if we must update the UI.
				// The generator seems to construct a top-level object.
				// If I export `export const en = { qrcodePanel: { ... } }`, it will be merged at top level.
				// So I can PRESERVE the `qrcodePanel` key in the new file, I don't have to nest it under `tools`.
				// BUT, standard for new tools is `tools.<id>`.
				// Existing tools use various keys.

				// Strategy: Preserve the original key structure to avoid breaking UI code.
				// In src/tools/qrcode/locales/en.ts:
				// export const en = {
				//    qrcodePanel: { ... }
				// }

				let fileContent = '';
				if (fs.existsSync(locFile)) {
					// If file exists (e.g. uuid we just created), we might append or merge? 
					// For this script, we assume we are migrating *new* stuff, maybe overwrite or merge.
					// Because UUID was a test, we can overwrite or ignore. 
					// Let's overwrite for simplicity of this Migration.
				}

				const exportObj = { [key]: data[key] };
				fileContent = `export const ${lang} = ${toTS(exportObj)};\n`;

				fs.writeFileSync(locFile, fileContent);
				console.log(`Migrated ${key} -> ${locFile}`);
			} else {
				console.warn(`Could not find tool directory for key: ${key} (tried ${computedId})`);
			}
		});
	});
}

function run() {
	processLang('en');
	processLang('zh');
}

run();
