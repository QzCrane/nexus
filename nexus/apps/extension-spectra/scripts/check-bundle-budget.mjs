import { readdirSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KiB = 1024;
const DIST_BASELINE = 517 * KiB;

export const BUNDLE_BUDGETS = Object.freeze({
	'content.js': 101 * KiB,
	'popup.js': 125 * KiB,
	'offscreen.js': 93 * KiB,
});

export const AGGREGATE_BUDGETS = Object.freeze({
	javascript: 480 * KiB,
	dist: Math.floor(DIST_BASELINE * 1.05),
});

function walk(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}

function format(bytes) {
	return `${(bytes / KiB).toFixed(1)}KiB`;
}

function findBundleOutput(metafile, bundleName) {
	return Object.entries(metafile.outputs).find(([path]) => {
		const normalized = path.replaceAll('\\', '/');
		return normalized === `dist/${bundleName}` || normalized.endsWith(`/dist/${bundleName}`);
	})?.[1];
}

function topContributors(bundleName, metafiles) {
	const build = metafiles.find((item) => item.name === bundleName);
	if (!build) return [];
	const output = findBundleOutput(build.metafile, bundleName);
	if (!output) return [];
	return Object.entries(output.inputs)
		.map(([path, info]) => ({ path, bytes: info.bytesInOutput ?? 0 }))
		.sort((left, right) => right.bytes - left.bytes)
		.slice(0, 8);
}

function topAggregateContributors(metafiles) {
	return metafiles.flatMap((build) => {
		const output = findBundleOutput(build.metafile, build.name);
		if (!output) return [];
		return Object.entries(output.inputs).map(([path, info]) => ({
			bundle: build.name,
			path,
			bytes: info.bytesInOutput ?? 0,
		}));
	}).sort((left, right) => right.bytes - left.bytes).slice(0, 12);
}

function reportAggregateContributors(files, metafiles) {
	const contributors = topAggregateContributors(metafiles);
	if (contributors.length) {
		console.error('Largest JavaScript module contributions:');
		for (const item of contributors) {
			console.error(`  ${format(item.bytes)}  ${item.bundle} <- ${item.path}`);
		}
	}
	console.error('Largest production files:');
	for (const path of files
		.map((path) => ({ path, bytes: statSync(path).size }))
		.sort((left, right) => right.bytes - left.bytes)
		.slice(0, 12)) {
		console.error(`  ${format(path.bytes)}  ${path.path}`);
	}
}

export function checkBundleBudget({ distDir, metafiles = [] }) {
	const failures = [];
	for (const [name, budget] of Object.entries(BUNDLE_BUDGETS)) {
		const path = resolve(distDir, name);
		const size = statSync(path).size;
		if (size > budget) {
			failures.push(`${name}: ${format(size)} > ${format(budget)}`);
			const contributors = topContributors(name, metafiles);
			if (contributors.length) {
				console.error(`Largest ${name} contributors:`);
				for (const item of contributors) console.error(`  ${format(item.bytes)}  ${item.path}`);
			}
		}
	}

	const files = walk(distDir).filter((path) => !path.endsWith('.map') && !path.endsWith('build-analysis.json'));
	const javascript = files.filter((path) => extname(path) === '.js').reduce((sum, path) => sum + statSync(path).size, 0);
	const total = files.reduce((sum, path) => sum + statSync(path).size, 0);
	const aggregateExceeded = javascript > AGGREGATE_BUDGETS.javascript || total > AGGREGATE_BUDGETS.dist;
	if (javascript > AGGREGATE_BUDGETS.javascript) {
		failures.push(`all JavaScript: ${format(javascript)} > ${format(AGGREGATE_BUDGETS.javascript)}`);
	}
	if (total > AGGREGATE_BUDGETS.dist) {
		failures.push(`production dist: ${format(total)} > ${format(AGGREGATE_BUDGETS.dist)}`);
	}
	if (aggregateExceeded) reportAggregateContributors(files, metafiles);

	if (failures.length) throw new Error(`Bundle budget exceeded:\n${failures.join('\n')}`);
	console.log(`✓ Bundle budget: JS ${format(javascript)}, dist ${format(total)}`);
	return { javascript, total };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
	checkBundleBudget({ distDir: resolve(projectDir, 'dist') });
}
