// goal: keep a bounded, locally-held record of how long a native write takes to
// physically land and how long its stabilization confirmation takes afterwards

import type { ControlWriteState } from '@nexus/contracts';

/**
 * Split-ack latency budget. The whole point of separating `written` from
 * `confirmed` is that the second number may stay large while the first one
 * collapses; without both recorded side by side the change cannot be verified
 * and the confirmation floor cannot be proven to have moved off the control
 * path rather than simply disappearing.
 *
 * Metric naming follows `spectra.<surface>.<scenario>.<metric>`:
 *   spectra.content.native-write.write-to-landed
 *   spectra.content.native-write.landed-to-settled
 */
export const NATIVE_WRITE_TELEMETRY_LIMIT = 96;

export interface NativeWriteSample {
	readonly id: number;
	readonly field: string;
	/** Milliseconds spent in the physical setter plus its immediate readback. */
	readonly writeMs: number;
	/** Outcome of the detached stabilization confirmation, null while pending. */
	writeState: ControlWriteState | null;
	/** Milliseconds from the physical write to a settled outcome. */
	confirmMs: number;
}

export interface NativeWritePercentiles {
	readonly p50: number;
	readonly p95: number;
	readonly max: number;
}

export interface NativeWriteTelemetrySummary {
	readonly samples: number;
	readonly pending: number;
	readonly byState: Readonly<Record<ControlWriteState, number>>;
	readonly writeMs: NativeWritePercentiles;
	readonly confirmMs: NativeWritePercentiles;
	/** Share of settled samples the page rolled back. */
	readonly driftRate: number;
	/** Share of settled samples whose stabilization never concluded. */
	readonly unconfirmedRate: number;
}

let sequence = 0;
let samples: NativeWriteSample[] = [];

export function recordNativeWrite(field: string, writeMs: number): number {
	const id = ++sequence;
	const entry: NativeWriteSample = {
		id,
		field,
		writeMs: Number.isFinite(writeMs) && writeMs >= 0 ? writeMs : 0,
		writeState: null,
		confirmMs: 0,
	};
	// A bounded ring keeps the buffer useless as a behavioural history: it holds
	// only the most recent samples and never grows with session length.
	samples = [...samples, entry].slice(-NATIVE_WRITE_TELEMETRY_LIMIT);
	return id;
}

export function settleNativeWrite(
	id: number,
	writeState: ControlWriteState,
	confirmMs: number,
): void {
	for (const sample of samples) {
		if (sample.id !== id) continue;
		sample.writeState = writeState;
		sample.confirmMs = Number.isFinite(confirmMs) && confirmMs >= 0 ? confirmMs : 0;
		return;
	}
}

export function resetNativeWriteTelemetry(): void {
	sequence = 0;
	samples = [];
}

function percentile(values: readonly number[], fraction: number): number {
	if (values.length === 0) return 0;
	const ordered = [...values].sort((left, right) => left - right);
	const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1));
	return ordered[index] ?? 0;
}

function summarize(values: readonly number[]): NativeWritePercentiles {
	return {
		p50: percentile(values, 0.5),
		p95: percentile(values, 0.95),
		max: values.length === 0 ? 0 : Math.max(...values),
	};
}

export function snapshotNativeWriteTelemetry(): NativeWriteTelemetrySummary {
	const byState: Record<ControlWriteState, number> = {
		written: 0,
		confirmed: 0,
		drifted: 0,
		unconfirmed: 0,
	};
	const settledSamples = samples.filter((sample) => sample.writeState !== null);
	for (const sample of settledSamples) {
		if (sample.writeState !== null) byState[sample.writeState] += 1;
	}
	const settledCount = settledSamples.length;
	return {
		samples: samples.length,
		pending: samples.length - settledCount,
		byState,
		writeMs: summarize(samples.map((sample) => sample.writeMs)),
		confirmMs: summarize(settledSamples.map((sample) => sample.confirmMs)),
		driftRate: settledCount === 0 ? 0 : byState.drifted / settledCount,
		unconfirmedRate: settledCount === 0 ? 0 : byState.unconfirmed / settledCount,
	};
}
