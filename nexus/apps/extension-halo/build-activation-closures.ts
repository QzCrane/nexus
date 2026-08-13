// goal: measure every lazy SidePanel activation as a complete physical static closure
// inv: a group of individually-small chunks cannot bypass the per-activation budget

import path from 'node:path';

interface ImportEdge {
	path: string;
	kind: string;
	external?: boolean;
}

interface OutputDetail {
	bytes: number;
	entryPoint?: string;
	imports?: ImportEdge[];
}

export interface ActivationClosure {
	target: string;
	entryPoint: string | null;
	bytes: number;
	fileCount: number;
}

export interface ActivationMetafile {
	outputs?: Record<string, OutputDetail>;
}

function absolute(root: string, output: string): string {
	return path.normalize(path.resolve(root, output));
}

function resolveEdge(
	root: string,
	outputs: ReadonlyMap<string, OutputDetail>,
	from: string,
	edgePath: string,
): string {
	const rootRelative = absolute(root, edgePath);
	if (outputs.has(rootRelative)) return rootRelative;
	return path.normalize(path.resolve(path.dirname(from), edgePath));
}

export function measureDynamicActivationClosures(
	metafile: ActivationMetafile,
	root: string,
): ActivationClosure[] {
	const outputs = new Map(
		Object.entries(metafile.outputs ?? {}).map(([output, detail]) => [absolute(root, output), detail]),
	);
	const targets = new Set<string>();
	for (const [output, detail] of outputs) {
		for (const edge of detail.imports ?? []) {
			if (edge.external || edge.kind !== 'dynamic-import') continue;
			const target = resolveEdge(root, outputs, output, edge.path);
			if (!outputs.has(target)) throw new Error(`Unresolved SidePanel dynamic activation output: ${edge.path}`);
			targets.add(target);
		}
	}

	return [...targets].map((target) => {
		const visited = new Set<string>();
		const stack = [target];
		let bytes = 0;
		while (stack.length > 0) {
			const current = stack.pop();
			if (!current || visited.has(current)) continue;
			const detail = outputs.get(current);
			if (!detail) throw new Error(`Unresolved SidePanel activation closure output: ${current}`);
			visited.add(current);
			bytes += detail.bytes;
			for (const edge of detail.imports ?? []) {
				if (edge.external || edge.kind === 'dynamic-import') continue;
				const dependency = resolveEdge(root, outputs, current, edge.path);
				if (outputs.has(dependency) && !visited.has(dependency)) stack.push(dependency);
			}
		}
		const detail = outputs.get(target);
		return {
			target: path.relative(root, target).replaceAll('\\', '/'),
			entryPoint: detail?.entryPoint ?? null,
			bytes,
			fileCount: visited.size,
		};
	}).sort((left, right) => right.bytes - left.bytes || left.target.localeCompare(right.target));
}

export function assertActivationClosureBudget(
	closures: readonly ActivationClosure[],
	budgetKiB: number,
): void {
	if (closures.length === 0) throw new Error('HALO SidePanel has no measurable dynamic activation boundaries');
	if (!Number.isSafeInteger(budgetKiB) || budgetKiB < 1) throw new Error('Invalid SidePanel activation budget');
	const exceeded = closures.find((closure) => Math.ceil(closure.bytes / 1024) > budgetKiB);
	if (exceeded) {
		throw new Error(
			`HALO SidePanel activation budget exceeded: ${exceeded.entryPoint ?? exceeded.target}`
			+ `=${Math.ceil(exceeded.bytes / 1024)}KiB > ${budgetKiB}KiB`,
		);
	}
}
