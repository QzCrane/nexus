import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KiB = 1024;
export const BUNDLE_BUDGETS = Object.freeze({
	'background.js': 220 * KiB,
	'content-bootstrap.js': 10 * KiB,
	'content-runtime.js': 190 * KiB,
	'popup.js': 195 * KiB,
	'offscreen.js': 135 * KiB,
	'options.js': 95 * KiB,
});

export const AGGREGATE_BUDGETS = Object.freeze({
	defaultStartup: 225 * KiB,
	javascript: 575 * KiB,
	dist: 680 * KiB,
});

const IMPORT_PATTERN = /(?:\bimport\s*(?:[^"'()]*?from\s*)?|\bimport\s*\()\s*["']([^"']+)["']/gu;

function walk(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory() ? walk(path) : [path];
	});
}

function format(bytes) {
	return `${(bytes / KiB).toFixed(1)}KiB`;
}

export function bundleFootprint(distDir, bundleName) {
	const root = resolve(distDir);
	const files = new Set();
	const visit = (path) => {
		const normalized = resolve(path);
		const localPath = relative(root, normalized);
		if (localPath.startsWith('..') || resolve(root, localPath) !== normalized) {
			throw new Error(`${bundleName}: import escapes production dist (${localPath})`);
		}
		if (files.has(normalized)) return;
		files.add(normalized);
		const source = readFileSync(normalized, 'utf8');
		for (const match of source.matchAll(IMPORT_PATTERN)) {
			const specifier = match[1];
			if (!specifier?.startsWith('.')) continue;
			visit(resolve(dirname(normalized), specifier));
		}
	};
	visit(resolve(root, bundleName));
	return {
		bytes: [...files].reduce((sum, path) => sum + statSync(path).size, 0),
		files: [...files],
	};
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
		try {
			statSync(path);
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
			failures.push(`${name}: required production bundle is missing`);
			continue;
		}
		const footprint = bundleFootprint(distDir, name);
		const size = footprint.bytes;
		if (size > budget) {
			failures.push(`${name}: ${format(size)} > ${format(budget)}`);
			const contributors = topContributors(name, metafiles);
			if (contributors.length) {
				console.error(`Largest ${name} contributors:`);
				for (const item of contributors) console.error(`  ${format(item.bytes)}  ${item.path}`);
			}
			if (footprint.files.length > 1) {
				console.error(`Largest ${name} dependency files:`);
				for (const dependency of footprint.files
					.map((dependency) => ({ dependency, bytes: statSync(dependency).size }))
					.sort((left, right) => right.bytes - left.bytes)
					.slice(0, 8)) {
					console.error(`  ${format(dependency.bytes)}  ${dependency.dependency}`);
				}
			}
		}
	}

	const files = walk(distDir).filter((path) => !path.endsWith('.map') && !path.endsWith('build-analysis.json'));
	const javascript = files.filter((path) => extname(path) === '.js').reduce((sum, path) => sum + statSync(path).size, 0);
	const total = files.reduce((sum, path) => sum + statSync(path).size, 0);
	const startupFiles = new Set([
		...bundleFootprint(distDir, 'background.js').files,
		...bundleFootprint(distDir, 'content-bootstrap.js').files,
	]);
	const defaultStartup = [...startupFiles].reduce((sum, path) => sum + statSync(path).size, 0);
	const aggregateExceeded = javascript > AGGREGATE_BUDGETS.javascript || total > AGGREGATE_BUDGETS.dist;
	if (defaultStartup > AGGREGATE_BUDGETS.defaultStartup) {
		failures.push(`default startup: ${format(defaultStartup)} > ${format(AGGREGATE_BUDGETS.defaultStartup)}`);
	}
	if (javascript > AGGREGATE_BUDGETS.javascript) {
		failures.push(`all JavaScript: ${format(javascript)} > ${format(AGGREGATE_BUDGETS.javascript)}`);
	}
	if (total > AGGREGATE_BUDGETS.dist) {
		failures.push(`production dist: ${format(total)} > ${format(AGGREGATE_BUDGETS.dist)}`);
	}
	if (aggregateExceeded) reportAggregateContributors(files, metafiles);

	if (failures.length) throw new Error(`Bundle budget exceeded:\n${failures.join('\n')}`);
	console.log(`✓ Bundle budget: startup ${format(defaultStartup)}, JS ${format(javascript)}, dist ${format(total)}`);
	return { defaultStartup, javascript, total };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
	checkBundleBudget({ distDir: resolve(projectDir, 'dist') });
}
