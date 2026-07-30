#!/usr/bin/env node
// goal: Analyze and report tool categories from _generated.ts
// usage: node scripts/analyze-categories.ts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_PATH = path.join(__dirname, '../apps/extension-halo/src/kernel/registry/_generated.ts');

const content = fs.readFileSync(GENERATED_PATH, 'utf-8');

// Extract all plugins with category
const pluginRegex = /id:\s*'([^']+)'[\s\S]*?pluginType:\s*'([^']+)'[\s\S]*?category:\s*'([^']+)'/g;
const plugins = [];
let match = pluginRegex.exec(content);
while (match !== null) {
	plugins.push({ id: match[1], type: match[2], category: match[3] });
	match = pluginRegex.exec(content);
}

// Group by category
const byCategory = {};
for (const p of plugins) {
	if (!byCategory[p.category]) byCategory[p.category] = [];
	byCategory[p.category].push(p);
}

console.log('📊 Plugin Category Distribution\n');
console.log('='.repeat(60));

const categories = Object.keys(byCategory).sort();
for (const cat of categories) {
	const items = byCategory[cat];
	const tools = items.filter(p => p.type === 'tool');
	const scripts = items.filter(p => p.type === 'script');
	const system = items.filter(p => p.type === 'system');
	
	console.log(`\n${cat.toUpperCase()} (${items.length})`);
	if (tools.length > 0) console.log(`  tools: ${tools.map(p => p.id).join(', ')}`);
	if (scripts.length > 0) console.log(`  scripts: ${scripts.map(p => p.id).join(', ')}`);
	if (system.length > 0) console.log(`  system: ${system.map(p => p.id).join(', ')}`);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Total: ${plugins.length} plugins (${plugins.filter(p => p.type === 'tool').length} tools, ${plugins.filter(p => p.type === 'script').length} scripts, ${plugins.filter(p => p.type === 'system').length} system)`);
