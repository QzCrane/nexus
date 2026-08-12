// goal: fail closed when production extension copy exceeds verified product behavior
// inv: submitted locale messages may describe capabilities, never universal compatibility or bypass

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceDir = dirname(dirname(fileURLToPath(import.meta.url)));
const spectraDir = resolve(workspaceDir, 'apps/extension-spectra');
const localesDir = resolve(spectraDir, 'public/_locales');
const forbidden = [
	/all websites/iu,
	/all sites/iu,
	/compatible (?:with|on) all/iu,
	/kompatibel mit allen websites/iu,
	/compatible con todos los sitios/iu,
	/compatible avec tous les sites/iu,
	/全サイト対応/iu,
	/모든 사이트 호환/iu,
	/совместим со всеми сайтами/iu,
	/兼容所有(?:网站|網站)/u,
];

const failures: string[] = [];
for (const locale of readdirSync(localesDir, { withFileTypes: true })) {
	if (!locale.isDirectory()) continue;
	const path = resolve(localesDir, locale.name, 'messages.json');
	const messages = JSON.parse(readFileSync(path, 'utf8')) as {
		extDescription?: { message?: unknown };
	};
	const description = messages.extDescription?.message;
	if (typeof description !== 'string' || description.trim().length === 0) {
		failures.push(`${locale.name}: missing extDescription.message`);
		continue;
	}
	if (forbidden.some((pattern) => pattern.test(description))) {
		failures.push(`${locale.name}: universal compatibility claim: ${JSON.stringify(description)}`);
	}
}

const storeOwner = readFileSync(resolve(spectraDir, 'store-listings/en-US.md'), 'utf8');
if (!storeOwner.includes('Availability depends on the page, media element, browser support, permissions, and user-activation rules.')) {
	failures.push('SPECTRA store owner is missing the verified availability limitation');
}

if (failures.length > 0) {
	throw new Error(`Public projection check failed:\n${failures.join('\n')}`);
}

console.log(`✓ Public projections: ${readdirSync(localesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length} SPECTRA locale descriptions are bounded by verified behavior`);
