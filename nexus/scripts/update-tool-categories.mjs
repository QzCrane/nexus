#!/usr/bin/env node
// goal: Batch update tool manifest categories
// usage: node scripts/update-tool-categories.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = path.join(__dirname, '../apps/extension-halo/src/tools');

// Category mapping: tool id -> new category
const CATEGORY_MAP = {
	// encode (编解码)
	'base64': 'encode',
	'gzip': 'encode',
	'hex-dump': 'encode',
	'html-entity': 'encode',
	'morse': 'encode',
	'punycode': 'encode',
	'rot13': 'encode',
	'xor': 'encode',
	'url': 'encode',
	
	// format (格式化/转换)
	'json-formatter': 'format',
	'json-path': 'format',
	'json-to-csv': 'format',
	'csv-to-json': 'format',
	'csv-viewer': 'format',
	'yaml': 'format',
	'xml-formatter': 'format',
	'sql-formatter': 'format',
	'code-formatter': 'format',
	'markdown': 'format',
	
	// network (网络/API)
	'api-tester': 'network',
	'network': 'network',
	'ip-lookup': 'network',
	'http-status': 'network',
	'headers-viewer': 'network',
	'ssl-cert': 'network',
	'jwt-decoder': 'network',
	
	// data (数据生成)
	'mock-data': 'data',
	'lorem-ipsum': 'data',
	'cron': 'data',
	'uuid': 'data',
	'timestamp': 'data',
	
	// dev (开发工具) - keep as dev
	'regex': 'dev',
	'diff': 'dev',
	'dom-selector': 'dev',
	'font-inspector': 'dev',
	'outline': 'dev',
	'protobuf': 'dev',
	'tech-stack': 'dev',
	'text-tools': 'dev',
	'storage-editor': 'dev',
	'user-agent': 'dev',
	'code-snippets': 'dev',
	'number-base': 'dev',
	'hash': 'dev',
	'crypto': 'dev',
};

let updated = 0;
let skipped = 0;

const dirs = fs.readdirSync(TOOLS_DIR, { withFileTypes: true })
	.filter(d => d.isDirectory())
	.map(d => d.name);

for (const toolId of dirs) {
	const manifestPath = path.join(TOOLS_DIR, toolId, 'manifest.json');
	if (!fs.existsSync(manifestPath)) continue;
	
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
	const newCategory = CATEGORY_MAP[toolId];
	
	if (newCategory && manifest.category !== newCategory) {
		const oldCategory = manifest.category;
		manifest.category = newCategory;
		
		// Also add pluginType if missing
		if (!manifest.pluginType) {
			manifest.pluginType = 'tool';
		}
		
		fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`, 'utf-8');
		console.log(`✓ ${toolId}: ${oldCategory} → ${newCategory}`);
		updated++;
	} else {
		skipped++;
	}
}

console.log(`\n📦 Updated: ${updated}, Skipped: ${skipped}`);
console.log('Run `node scripts/generate-tool-registry.mjs` to regenerate registry');
