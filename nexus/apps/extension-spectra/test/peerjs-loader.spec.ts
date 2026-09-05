import { describe, expect, test } from 'bun:test';
import { createPeerRuntimeLoader } from '../src/offscreen-remote/peerjs-loader';

describe('offscreen PeerJS runtime loader', () => {
	test('coalesces one local module load and keeps the loaded runtime', async () => {
		let releaseLoad!: (module: { default: unknown }) => void;
		let loadCalls = 0;
		class FakePeer {}
		const loader = createPeerRuntimeLoader({
			loadModule: () => {
				loadCalls += 1;
				return new Promise((resolve) => { releaseLoad = resolve; });
			},
			setTimer: () => 1,
			clearTimer: () => undefined,
		});

		const first = loader.ensure();
		const second = loader.ensure();
		expect(second).toBe(first);
		expect(loadCalls).toBe(1);
		releaseLoad({ default: FakePeer });
		await Promise.all([first, second]);
		await expect(loader.ensure()).resolves.toBeUndefined();
		expect(loadCalls).toBe(1);
		expect(loader.createPeer('spectra-test')).toBeInstanceOf(FakePeer);
	});

	test('rejects an invalid module and retries only when ensure is called again', async () => {
		let loadCalls = 0;
		class FakePeer {}
		const loader = createPeerRuntimeLoader({
			loadModule: () => {
				loadCalls += 1;
				return Promise.resolve(loadCalls === 1 ? {} : { default: FakePeer });
			},
			setTimer: () => 1,
			clearTimer: () => undefined,
		});

		const invalid = loader.ensure();
		await expect(invalid).rejects.toThrow('without exporting Peer');
		expect(loadCalls).toBe(1);

		const retry = loader.ensure();
		expect(loadCalls).toBe(2);
		await expect(retry).resolves.toBeUndefined();
		expect(loader.createPeer('spectra-retry')).toBeInstanceOf(FakePeer);
	});

	test('disposal aborts one in-flight load and forbids later work', async () => {
		let releaseLoad!: (module: { default: unknown }) => void;
		const loader = createPeerRuntimeLoader({
			loadModule: () => new Promise((resolve) => { releaseLoad = resolve; }),
			setTimer: () => 1,
			clearTimer: () => undefined,
		});

		const pending = loader.ensure();
		loader.dispose();
		await expect(pending).rejects.toThrow('disposed');
		await expect(loader.ensure()).rejects.toThrow('disposed');
		releaseLoad({ default: class FakePeer {} });
		await Promise.resolve();
		expect(() => loader.createPeer('spectra-disposed')).toThrow('unavailable');
	});

	test('fences a timed-out dynamic import from satisfying a later attempt', async () => {
		const releases: Array<(module: { default: unknown }) => void> = [];
		const timers: Array<() => void> = [];
		class OldPeer {}
		class NewPeer {}
		const loader = createPeerRuntimeLoader({
			loadModule: () => new Promise((resolve) => { releases.push(resolve); }),
			setTimer: (callback) => { timers.push(callback); return timers.length; },
			clearTimer: () => undefined,
		});

		const first = loader.ensure();
		expect(releases).toHaveLength(1);
		timers[0]();
		await expect(first).rejects.toThrow('timed out');

		const second = loader.ensure();
		expect(releases).toHaveLength(2);
		releases[0]({ default: OldPeer });
		await Promise.resolve();
		releases[1]({ default: NewPeer });
		await expect(second).resolves.toBeUndefined();
		expect(loader.createPeer('spectra-current')).toBeInstanceOf(NewPeer);
	});
});
