import { describe, expect, test } from 'bun:test';
import { createPeerRuntimeLoader } from '../src/offscreen-remote/peerjs-loader';

describe('offscreen PeerJS runtime loader', () => {
	test('coalesces one local script load and keeps the ready runtime', async () => {
		let peerReady = false;
		let created = 0;
		let onLoad!: () => void;
		let removed = 0;
		const loader = createPeerRuntimeLoader({
			hasPeer: () => peerReady,
			resolveUrl: () => 'chrome-extension://spectra/peerjs-vendor.js',
			createScript: (url, load) => {
				expect(url).toBe('chrome-extension://spectra/peerjs-vendor.js');
				created += 1;
				onLoad = load;
				return { remove: () => { removed += 1; } };
			},
			setTimer: () => 1,
			clearTimer: () => undefined,
		});

		const first = loader.ensure();
		const second = loader.ensure();
		expect(second).toBe(first);
		expect(created).toBe(1);
		peerReady = true;
		onLoad();
		await Promise.all([first, second]);
		await expect(loader.ensure()).resolves.toBeUndefined();
		expect(created).toBe(1);
		expect(removed).toBe(1);
	});

	test('rejects an invalid load and retries only when ensure is called again', async () => {
		let peerReady = false;
		let created = 0;
		let onLoad!: () => void;
		const loader = createPeerRuntimeLoader({
			hasPeer: () => peerReady,
			resolveUrl: () => 'peerjs-vendor.js',
			createScript: (_url, load) => {
				created += 1;
				onLoad = load;
				return { remove: () => undefined };
			},
			setTimer: () => 1,
			clearTimer: () => undefined,
		});

		const invalid = loader.ensure();
		onLoad();
		await expect(invalid).rejects.toThrow('without installing globalThis.Peer');
		expect(created).toBe(1);

		const retry = loader.ensure();
		expect(created).toBe(2);
		peerReady = true;
		onLoad();
		await expect(retry).resolves.toBeUndefined();
	});

	test('disposal aborts one in-flight load and forbids later work', async () => {
		let removed = 0;
		const loader = createPeerRuntimeLoader({
			hasPeer: () => false,
			resolveUrl: () => 'peerjs-vendor.js',
			createScript: () => ({ remove: () => { removed += 1; } }),
			setTimer: () => 1,
			clearTimer: () => undefined,
		});

		const pending = loader.ensure();
		loader.dispose();
		await expect(pending).rejects.toThrow('disposed');
		await expect(loader.ensure()).rejects.toThrow('disposed');
		expect(removed).toBe(1);
	});
});
