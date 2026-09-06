import { describe, expect, test } from 'bun:test';
import {
	readArchitectureClosureManifest,
	validateArchitectureClosure,
} from './check-architecture-closure';

describe('Architecture Closure Epoch manifest', () => {
	test('accepts the current retained task owner', () => {
		expect(validateArchitectureClosure(readArchitectureClosureManifest())).toEqual([]);
	});

	test('rejects disappearing or duplicate retained tasks', () => {
		const missing = structuredClone(readArchitectureClosureManifest());
		missing.tasks = missing.tasks.filter((task) => task.id !== 'SPECTRA-MEDIA-TAB-INVENTORY');
		expect(validateArchitectureClosure(missing).some((error) => error.includes('SPECTRA-MEDIA-TAB-INVENTORY')))
			.toBe(true);

		const duplicate = structuredClone(readArchitectureClosureManifest());
		duplicate.tasks.push(structuredClone(duplicate.tasks[0]));
		expect(validateArchitectureClosure(duplicate).some((error) => error.includes('duplicate task id')))
			.toBe(true);
	});

	test('keeps individual HALO feature internals at the terminal priority', () => {
		const manifest = structuredClone(readArchitectureClosureManifest());
		const pdf = manifest.tasks.find((task) => task.id === 'HALO-PDF-CLOSURE');
		if (!pdf) throw new Error('HALO PDF closure task missing');
		pdf.priority = 'P1';
		expect(validateArchitectureClosure(manifest).some((error) => error.includes('individual HALO feature work must remain P2')))
			.toBe(true);
	});

	test('requires evidence for done and counter-evidence for rejection', () => {
		const done = structuredClone(readArchitectureClosureManifest());
		const task = done.tasks.find((candidate) => candidate.id === 'DEPENDENCY-DEAD-DIRECTS');
		if (!task) throw new Error('dependency task missing');
		task.status = 'done';
		task.evidence = [];
		expect(validateArchitectureClosure(done).some((error) => error.includes('done requires retained evidence')))
			.toBe(true);

		const rejected = structuredClone(readArchitectureClosureManifest());
		const rejectedTask = rejected.tasks.find((candidate) => candidate.id === 'VISUAL-REGRESSION-GATE');
		if (!rejectedTask) throw new Error('visual task missing');
		rejectedTask.status = 'rejected';
		expect(validateArchitectureClosure(rejected).some((error) => error.includes('rejected requires counter-evidence')))
			.toBe(true);
	});
});
