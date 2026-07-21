import { describe, expect, test } from 'bun:test';
import type { AudioSessionPhase } from '@nexus/contracts';
import { shouldAcceptAudioSessionPhase } from '../src/shared/audio-session-phase';

// Regression guards for the same-generation phase transition rules.
// These rules reject delayed intent notifications that would otherwise put
// the UI/persistence mirror back into a transitional phase after a stable
// ACK has been recorded. The `starting → idle` and `stopping → active`
// transitions are explicitly permitted because a processor may stop or
// re-enable before reaching the stable target.

function accept(
	currentPhase: AudioSessionPhase,
	nextPhase: AudioSessionPhase,
	generation = 1,
): boolean {
	return shouldAcceptAudioSessionPhase(generation, currentPhase, generation, nextPhase);
}

describe('audio session phase transitions', () => {
	test('更高的 generation 总是被接受 (不论 phase)', () => {
		expect(shouldAcceptAudioSessionPhase(1, 'active', 2, 'starting')).toBe(true);
		expect(shouldAcceptAudioSessionPhase(1, 'active', 2, 'idle')).toBe(true);
		expect(shouldAcceptAudioSessionPhase(1, 'idle', 5, 'error')).toBe(true);
		expect(shouldAcceptAudioSessionPhase(1, 'error', 2, 'starting')).toBe(true);
		expect(shouldAcceptAudioSessionPhase(3, 'stopping', 4, 'active')).toBe(true);
	});

	test('更低的 generation 总是被拒绝', () => {
		expect(shouldAcceptAudioSessionPhase(2, 'active', 1, 'active')).toBe(false);
		expect(shouldAcceptAudioSessionPhase(5, 'idle', 1, 'starting')).toBe(false);
		expect(shouldAcceptAudioSessionPhase(4, 'error', 3, 'active')).toBe(false);
	});

	test('同 generation + 同 phase: 接受', () => {
		expect(accept('starting', 'starting')).toBe(true);
		expect(accept('active', 'active')).toBe(true);
		expect(accept('idle', 'idle')).toBe(true);
		expect(accept('stopping', 'stopping')).toBe(true);
		expect(accept('error', 'error')).toBe(true);
	});

	test('starting → active: 接受', () => {
		expect(accept('starting', 'active')).toBe(true);
	});

	test('starting → idle: 接受 (新允许的过渡)', () => {
		// 处理器可能在到达 active 之前直接停止 / 失败而进入 idle。
		expect(accept('starting', 'idle')).toBe(true);
	});

	test('starting → error: 接受', () => {
		expect(accept('starting', 'error')).toBe(true);
	});

	test('stopping → idle: 接受', () => {
		expect(accept('stopping', 'idle')).toBe(true);
	});

	test('stopping → active: 接受 (新允许的过渡)', () => {
		// 用户可能在处理器完成停止之前重新启用音频。
		expect(accept('stopping', 'active')).toBe(true);
	});

	test('stopping → error: 接受', () => {
		expect(accept('stopping', 'error')).toBe(true);
	});

	test('starting → starting: 接受 (同 phase)', () => {
		expect(accept('starting', 'starting')).toBe(true);
	});

	test('idle → active: 拒绝 (必须经过 starting)', () => {
		expect(accept('idle', 'active')).toBe(false);
	});

	test('active → idle: 拒绝 (必须经过 stopping)', () => {
		expect(accept('active', 'idle')).toBe(false);
	});

	test('idle → error: 接受', () => {
		expect(accept('idle', 'error')).toBe(true);
	});

	test('active → error: 接受', () => {
		expect(accept('active', 'error')).toBe(true);
	});

	test('error → starting: 拒绝 (需要新 generation)', () => {
		// error → starting requires a new generation, accepted by the generation
		// check, not by same-gen transition. 同 generation 下 error 是权威终态,
		// 恢复到 starting 必须提升 generation —— 这是设计意图,不是 bug。
		expect(accept('error', 'starting')).toBe(false);
		// 提升到更高 generation 后,error → starting 应被接受
		expect(shouldAcceptAudioSessionPhase(1, 'error', 2, 'starting')).toBe(true);
	});
});
