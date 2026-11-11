// goal: a same-document runtime replacement must not strand volume on an old media ID
// inv: use the built extension and canonical isolated browser/profile lifecycle
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import {
	SMOKE_TONE_WAV, acquireSmokeRuntime, evaluateServiceWorker, eventually,
	fixturePage, fixtureUrl, getRuntimeLeaseClient, getTabId, prepareSmokeSession,
	readContentBootstrapStatus, releaseSmokeRuntime, startSmokeSession, submitPopupControlIntent, teardownSmokeSession,
	sendFromActionPopup, readBadgeText, openActionPopupTarget, closeActionPopup,
	openExtensionClient, patchExtensionSettings,
} from './harness';

describe('volume after same-document runtime replacement', () => {
	beforeEach(async () => {
		const options = await prepareSmokeSession();
		await startSmokeSession(await launchPuppeteerBrowser(options, {
			owner: 'apps/extension-spectra/test/smoke/live-target-restart.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		}));
	}, 60_000);
	afterEach(teardownSmokeSession);

	test.each([false, true])('volume and unmute belong to the live broadcast beside a larger advertisement (live paused: %s)', async (paused) => {
		await fixturePage.goto(`${fixtureUrl}?broadcast-and-ad=1`, { waitUntil: 'domcontentloaded' });
		await fixturePage.evaluate(async bytes => {
			const live = document.querySelector<HTMLVideoElement>('#v');
			if (!live) throw new Error('Live player is missing');
			live.style.cssText = 'position:fixed;left:0;top:0;width:224px;height:126px';
			const canvas = document.createElement('canvas');
			canvas.width = 224; canvas.height = 126;
			canvas.getContext('2d')?.fillRect(0, 0, 224, 126);
			const stream = canvas.captureStream(1);
			const context = new AudioContext();
			const oscillator = context.createOscillator();
			const audio = context.createMediaStreamDestination();
			oscillator.connect(audio); oscillator.start();
			await context.resume();
			for (const track of audio.stream.getAudioTracks()) stream.addTrack(track);
			live.srcObject = stream;
			live.volume = 0; live.muted = true;
			await live.play();
			const ad = document.createElement('video');
			ad.id = 'finite-ad';
			ad.style.cssText = 'position:fixed;left:240px;top:0;width:640px;height:360px';
			ad.src = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }));
			ad.loop = true; ad.volume = 0.8; ad.muted = false;
			document.body.append(ad);
			await ad.play();
		}, [...SMOKE_TONE_WAV]);
		if (paused) await fixturePage.$eval('#v', video => (video as HTMLVideoElement).pause());
		const tabId = await getTabId(fixturePage.url());
		const operation = (operation: 'set' | 'delta', value: number) => sendFromActionPopup({
			protocolVersion: 2, requestId: crypto.randomUUID(), tabId, type: 'spectra.control.operation.submit',
			payload: { tabId, source: 'popup', target: null, operation: 'effective-volume', payload: { operation, value } },
		});
		const first = await operation('set', 40);
		expect(first.ok).toBe(true);
		const physical = () => fixturePage.evaluate(() => ({
			live: { volume: document.querySelector<HTMLVideoElement>('#v')?.volume, muted: document.querySelector<HTMLVideoElement>('#v')?.muted },
			ad: { volume: document.querySelector<HTMLVideoElement>('#finite-ad')?.volume, muted: document.querySelector<HTMLVideoElement>('#finite-ad')?.muted },
		}));
		expect(await physical()).toEqual({ live: { volume: 0.4, muted: false }, ad: { volume: 0.8, muted: false } });
		await fixturePage.$eval('#finite-ad', async node => {
			const ad = node as HTMLVideoElement;
			const changed = new Promise<void>(resolve => ad.addEventListener('volumechange', () => resolve(), { once: true }));
			ad.volume = 0; ad.muted = true;
			await changed;
		});
		await fixturePage.bringToFront();
		const next = await operation('delta', 10);
		expect(next.ok).toBe(true);
		expect(next.data.fields.volumeBase.strategy).toBe('dom-native');
		expect(await physical()).toEqual({ live: { volume: 0.5, muted: false }, ad: { volume: 0, muted: true } });
		await eventually(() => readBadgeText(tabId), value => value === '50', 'live volume owns the badge, not ad mute');
	}, 30_000);

	test('same-URL history replacement during first volume control does not cancel its ACK', async () => {
		await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
		await fixturePage.evaluate(() => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
			if (!video || !descriptor?.get || !descriptor.set) throw new Error('Native media volume descriptor missing');
			video.muted = true;
			Object.defineProperty(video, 'volume', { configurable: true,
				get: () => descriptor.get?.call(video),
				set: value => {
					descriptor.set?.call(video, value);
					if (value === 0.4) history.replaceState(history.state, '', location.href);
				},
			});
		});
		const tabId = await getTabId(fixturePage.url());
		const response = await sendFromActionPopup({ protocolVersion: 2, requestId: crypto.randomUUID(), tabId,
			type: 'spectra.control.operation.submit', payload: { tabId, source: 'popup', target: null,
				operation: 'effective-volume', payload: { operation: 'set', value: 40 } } });
		if (!response.ok) throw new Error(JSON.stringify(response.error));
		expect(await fixturePage.$eval('#v', node => ({ volume: (node as HTMLVideoElement).volume, muted: (node as HTMLVideoElement).muted })))
			.toEqual({ volume: 0.4, muted: false });
		await eventually(() => readBadgeText(tabId), value => value === '40', 'same-URL volume commit reaches badge');
	});

	test('cold volume control does not wait for an unrelated page script to finish loading', async () => {
		let releaseScript!: () => void;
		const heldScript = new Promise<void>(resolve => { releaseScript = resolve; });
		const source = `data:audio/wav;base64,${Buffer.from(SMOKE_TONE_WAV).toString('base64')}`;
		const slowPageServer = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
			if (new URL(request.url).pathname === '/held.js') {
				await heldScript;
				return new Response('', { headers: { 'content-type': 'application/javascript' } });
			}
			return new Response(`<html><body><video id="v" autoplay loop src="${source}" style="width:640px;height:360px"></video><script src="/held.js"></script></body></html>`,
				{ headers: { 'content-type': 'text/html' } });
		} });
		const url = `http://127.0.0.1:${slowPageServer.port}/cold-volume`;
		const navigation = fixturePage.goto(url, { waitUntil: 'domcontentloaded' });
		try {
			await fixturePage.waitForSelector('#v');
			const tabId = await getTabId(url);
			const control = sendFromActionPopup({ protocolVersion: 2, requestId: crypto.randomUUID(), tabId,
				type: 'spectra.control.operation.submit', payload: { tabId, source: 'popup', target: null,
					operation: 'effective-volume', payload: { operation: 'set', value: 40 } } });
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const completed = await Promise.race([control.then(response => ({ response })),
				new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 2_000); })]);
			if (timeout) clearTimeout(timeout);
			const physical = await fixturePage.evaluate(() => ({ readyState: document.readyState,
				volume: document.querySelector<HTMLVideoElement>('#v')?.volume }));
			releaseScript();
			await navigation;
			await control;
			expect(completed?.response.ok).toBe(true);
			expect(physical).toEqual({ readyState: 'loading', volume: 0.4 });
		} finally {
			releaseScript();
			await navigation;
			await slowPageServer.stop(true);
		}
	}, 30_000);

	test('discovers a cold live stream before playback and follows a real stream replacement without a control request', async () => {
		const settings = await openExtensionClient('options.html');
		await patchExtensionSettings(settings, { scope: 'audio-site', domain: '127.0.0.1', mode: 'replace',
			value: { volume: 40, volumeBase: 40, boost: 1 } });
		await settings.close();
		const finiteSource = `data:audio/wav;base64,${Buffer.from(SMOKE_TONE_WAV).toString('base64')}`;
		const html = `<!doctype html><html><body>
			<video id="ad" loop style="width:640px;height:360px" src="${finiteSource}"></video>
			<video id="live" style="display:none;width:224px;height:126px"></video>
			<script>
			const ad = document.getElementById('ad'), live = document.getElementById('live');
			const retained = []; window.events = [];
			for (const type of ['loadstart','loadedmetadata','loadeddata','playing','pause']) {
				live.addEventListener(type, () => window.events.push({ type, ready: live.readyState, duration: String(live.duration) }));
			}
			window.replaceLive = async () => {
				const canvas = document.createElement('canvas'); canvas.width = 224; canvas.height = 126;
				canvas.getContext('2d').fillRect(0, 0, 224, 126);
				const stream = canvas.captureStream(10), context = new AudioContext();
				const oscillator = context.createOscillator(), audio = context.createMediaStreamDestination();
				oscillator.connect(audio); oscillator.start(); await context.resume();
				for (const track of audio.stream.getAudioTracks()) stream.addTrack(track);
				retained.push({canvas, context, oscillator, stream});
				live.srcObject = stream; live.volume = 1; await live.play(); live.pause(); live.style.display = 'block';
				live.dataset.generation = String(retained.length);
			};
			(async () => { await ad.play(); await window.replaceLive(); })().catch(error => { window.startupError = String(error); });
			</script></body></html>`;
		const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response(html,
			{ headers: { 'content-type': 'text/html' } }) });
		try {
			await fixturePage.goto(`http://127.0.0.1:${server.port}/cold-live`, { waitUntil: 'domcontentloaded' });
			const physical = () => fixturePage.evaluate(() => {
				const live = document.querySelector<HTMLVideoElement>('#live');
				const ad = document.querySelector<HTMLVideoElement>('#ad');
				return { generation: live?.dataset.generation, volume: live?.volume, paused: live?.paused,
					live: live?.duration === Infinity, adVolume: ad?.volume, adPlaying: ad?.paused === false };
			});
			await eventually(physical, state => state.generation === '1' && state.live && state.paused === true
				&& state.adPlaying && state.volume === 0.4, 'cold paused broadcast receives saved volume while the ad plays');
			await fixturePage.evaluate(async () => {
				await (window as Window & { replaceLive: () => Promise<void> }).replaceLive();
			});
			await eventually(physical, state => state.generation === '2' && state.live && state.paused === true
				&& state.volume === 0.4, 'second physical stream receives retained volume without a control request');
			// Only after both automatic phases: the very first explicit gesture
			// must succeed on the broadcast and leave the ad's current level alone.
			const adVolume = (await physical()).adVolume;
			const tabId = await getTabId(fixturePage.url());
			const response = await sendFromActionPopup({ protocolVersion: 2, type: 'spectra.control.operation.submit', tabId,
				payload: { tabId, source: 'popup', target: null, operation: 'effective-volume', payload: { operation: 'set', value: 60 } } });
			expect(response.ok).toBe(true);
			expect(await physical()).toMatchObject({ volume: 0.6, adVolume, live: true, paused: true });
		} finally { server.stop(true); }
	}, 30_000);

	test('a cold restore rejected before Content is resumed by media readiness without any control request', async () => {
		const settings = await openExtensionClient('options.html');
		await patchExtensionSettings(settings, { scope: 'audio-site', domain: '127.0.0.1', mode: 'replace',
			value: { volume: 40, volumeBase: 40, boost: 1 } });
		await settings.close();
		const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response(
			'<!doctype html><html><body><video id="v" style="width:640px;height:360px"></video></body></html>',
			{ headers: { 'content-type': 'text/html' } }) });
		await evaluateServiceWorker(() => {
			const scope = globalThis as typeof globalThis & { __coldRestore?: {
				original: typeof chrome.tabs.sendMessage; allow: boolean; rejected: number;
			} };
			const gate = { original: chrome.tabs.sendMessage, allow: false, rejected: 0 };
			scope.__coldRestore = gate;
			chrome.tabs.sendMessage = ((...args: unknown[]) => {
				const message = args[1] as { type?: string; payload?: { source?: string } };
				if (!gate.allow && message?.type === 'spectra.control.intent.execute' && message.payload?.source === 'restore') {
					gate.rejected++;
					return Promise.resolve({ ok: false, error: { code: 'stale-media-source',
						message: 'The media source changed before the asynchronous native operation committed', retryable: true } });
				}
				return Reflect.apply(gate.original, chrome.tabs, args);
			}) as typeof chrome.tabs.sendMessage;
		});
		try {
			await fixturePage.goto(`http://127.0.0.1:${server.port}/cold-restore`, { waitUntil: 'domcontentloaded' });
			await eventually(() => evaluateServiceWorker(() => (globalThis as typeof globalThis & {
				__coldRestore?: { rejected: number };
			}).__coldRestore?.rejected ?? 0), value => value > 0, 'initial automatic restore rejected before template installation');
			await evaluateServiceWorker(() => {
				const gate = (globalThis as typeof globalThis & { __coldRestore?: { allow: boolean } }).__coldRestore;
				if (gate) gate.allow = true;
			});
			await fixturePage.evaluate(async source => {
				const video = document.querySelector<HTMLVideoElement>('#v');
				if (!video) throw new Error('Cold player missing');
				video.src = source; video.loop = true; await video.play();
			}, `data:audio/wav;base64,${Buffer.from(SMOKE_TONE_WAV).toString('base64')}`);
			// DOM readback only: no popup, status, snapshot, hotkey or second control
			// may rescue the initializer after the actual media lifecycle signal.
			await eventually(() => fixturePage.$eval('#v', node => (node as HTMLVideoElement).volume),
				value => Math.abs(value - 0.4) < 0.001, 'cold media autonomously consumes the saved 40 percent volume');
		} finally {
			await evaluateServiceWorker(() => {
				const scope = globalThis as typeof globalThis & { __coldRestore?: { original: typeof chrome.tabs.sendMessage } };
				if (scope.__coldRestore) chrome.tabs.sendMessage = scope.__coldRestore.original;
				delete scope.__coldRestore;
			});
			server.stop(true);
		}
	}, 30_000);

	test('automatically follows consecutive player replacements with no control request after the switch', async () => {
		await fixturePage.goto(`${fixtureUrl}?automatic-source-replacement=1`, { waitUntil: 'domcontentloaded' });
		const tabId = await getTabId(fixturePage.url());
		const initial = await submitPopupControlIntent(tabId, { requestedCoverage: 'active-target', patch: { volumeBase: 40 } });
		expect(initial.ok).toBe(true);
		await fixturePage.evaluate(async source => {
			const original = document.querySelector<HTMLVideoElement>('#v');
			if (!original?.parentElement) throw new Error('Fixture player missing');
			const host = original.parentElement as HTMLElement & {
				spectraExactController?: { video: HTMLVideoElement; getVolume(): number; setVolume(value: number): void };
			};
			const players = await Promise.all([1, 2].map(async index => {
				const video = document.createElement('video');
				video.id = 'v'; video.dataset.generation = String(index);
				video.src = source; video.loop = true; video.volume = 1;
				video.style.cssText = 'width:640px;height:360px';
				await video.play(); video.pause();
				return video;
			}));
			const [first, last] = players;
			if (!first || !last) throw new Error('Replacement players missing');
			let swapped = false;
			host.spectraExactController = { video: first, getVolume: () => first.volume * 100, setVolume(value) {
				first.volume = value / 100;
				if (swapped) return;
				swapped = true;
				queueMicrotask(() => {
					first.pause(); first.replaceWith(last);
					host.spectraExactController = { video: last, getVolume: () => last.volume * 100,
						setVolume: value => { last.volume = value / 100; } };
					void last.play();
				});
			} };
			original.pause(); original.replaceWith(first); await first.play();
		}, `data:audio/wav;base64,${Buffer.from(SMOKE_TONE_WAV).toString('base64')}`);
		// Only DOM and browser action readback follows. No snapshot/control RPC
		// may discover the new source or rescue the failed automatic write.
		await eventually(() => fixturePage.$eval('#v', node => ({
			generation: (node as HTMLElement).dataset.generation, volume: (node as HTMLVideoElement).volume,
		})), state => state.generation === '2' && Math.abs(state.volume - 0.4) < 0.001,
		'newest player consumes the retained volume without opening popup');
		try {
			await eventually(() => readBadgeText(tabId), text => text === '40', 'automatic replacement updates badge');
		} catch (error) {
			console.log(JSON.stringify({ automaticReplacement: await storedSummary(tabId) }));
			throw error;
		}
	}, 30_000);

	test.each([['operation', 1], ['operation', 2], ['popup', 2], ['operation-gap', 1]] as const)('one %s volume gesture survives %s source replacements', async (surface, replacements) => {
		await fixturePage.goto(`${fixtureUrl}?volume-source-replacement=1`, { waitUntil: 'domcontentloaded' });
		await fixturePage.evaluate(async ({ source, replacements, gap }) => {
			const original = document.querySelector<HTMLVideoElement>('#v');
			if (!original?.parentElement) throw new Error('Fixture player is missing');
			original.src = source;
			original.loop = true;
			original.volume = 0.6;
			await original.play();
			const players = [original];
			for (let index = 0; index < replacements; index++) {
				const replacement = document.createElement('video');
				replacement.src = source;
				replacement.loop = true;
				replacement.id = 'v';
				replacement.dataset.replacement = 'true';
				replacement.dataset.generation = String(index + 1);
				replacement.style.cssText = 'width:640px;height:360px';
				await replacement.play();
				replacement.pause();
				players.push(replacement);
			}
			const host = original.parentElement as HTMLElement & {
				spectraExactController?: { video: HTMLVideoElement; getVolume(): number; setVolume(value: number): void };
			};
			const controller = (video: HTMLVideoElement, index: number) => ({ video,
				getVolume: () => video.volume * 100,
				setVolume: (value: number) => {
					video.volume = value / 100;
					const replacement = players[index + 1];
					if (!replacement || video.dataset.retired || host.dataset.swapOnVolume !== 'armed') return;
					video.dataset.retired = 'true';
					queueMicrotask(() => {
						video.pause();
						const mount = () => {
							if (video.isConnected) video.replaceWith(replacement);
							else host.append(replacement);
							host.spectraExactController = controller(replacement, index + 1);
							void replacement.play();
						};
						if (gap) { video.remove(); setTimeout(mount, 100); }
						else mount();
					});
				},
			});
			host.spectraExactController = controller(original, 0);
		}, { source: `data:audio/wav;base64,${Buffer.from(SMOKE_TONE_WAV).toString('base64')}`, replacements, gap: surface === 'operation-gap' });
		const url = fixturePage.url();
		const tabId = await getTabId(url);
		const lease = surface !== 'popup' ? await acquireSmokeRuntime(url, 'source-replacement-volume') : null;
		const popup = surface === 'popup' ? await (await openActionPopupTarget()).asPage() : null;
		try {
			if (surface === 'popup' && !popup) throw new Error('Action popup missing');
			if (popup) await popup.waitForFunction(() => {
				const slider = document.querySelector<HTMLInputElement>('.vol-slider');
				return slider?.value === '60' && !slider.disabled;
			});
			await fixturePage.$eval('#v', video => {
				if (!video.parentElement) throw new Error('Player host is missing');
				video.parentElement.dataset.swapOnVolume = 'armed';
			});
			if (popup) {
				await popup.$eval('.vol-slider', node => {
					const slider = node as HTMLInputElement;
					slider.value = '40';
					slider.dispatchEvent(new Event('input', { bubbles: true }));
					slider.dispatchEvent(new Event('change', { bubbles: true }));
				});
			} else {
				const response = await sendFromActionPopup({ protocolVersion: 2, requestId: crypto.randomUUID(),
				type: 'spectra.control.operation.submit', payload: { tabId, source: 'popup', target: null,
					operation: 'effective-volume', payload: { operation: 'set', value: 40 } }, tabId });
			console.log(JSON.stringify({ sourceReplacement: response }));
			expect(response.ok).toBe(true);
			if (!response.ok) throw new Error(JSON.stringify(response));
			expect(response.data.result).toMatchObject({ effectiveVolume: 40 });
			}
			await eventually(() => fixturePage.$eval('#v', video => ({ volume: (video as HTMLVideoElement).volume,
				generation: (video as HTMLElement).dataset.generation })),
				state => state.generation === String(replacements) && Math.abs(state.volume - 0.4) < 0.001,
				'replacement player receives the original volume');
			await eventually(() => readBadgeText(tabId), text => text === '40', 'badge follows replacement volume');
			if (popup) {
				expect(await popup.$eval('.vol-slider', node => (node as HTMLInputElement).value)).toBe('40');
				expect(await popup.$$eval('.popup-toast-error', nodes => nodes.map(node => node.textContent))).toEqual([]);
			}
		} finally {
			if (popup) await closeActionPopup(popup);
			if (lease) await releaseSmokeRuntime(lease);
		}
	}, 40_000);

	test.each(['reused', 'missing'] as const)('the first real shortcut survives a %s old media ID', async (mode) => {
		await fixturePage.goto(`${fixtureUrl}?runtime-target=${mode}`, { waitUntil: 'domcontentloaded' });
		await fixturePage.evaluate(async ({ source, missing }) => {
			const video = document.querySelector<HTMLVideoElement>('#v');
			if (!video) throw new Error('Fixture video is missing');
			if (missing) {
				const initialPreview = document.createElement('video');
				initialPreview.id = 'old-preview';
				initialPreview.style.display = 'none';
				document.body.prepend(initialPreview);
			}
			video.style.cssText = 'width:640px;height:360px';
			video.src = source;
			video.loop = true;
			video.volume = 0.4;
			await video.play();
		}, { source: `data:audio/wav;base64,${Buffer.from(SMOKE_TONE_WAV).toString('base64')}`, missing: mode === 'missing' });
		const url = fixturePage.url();
		const tabId = await getTabId(url);
		const lease = await acquireSmokeRuntime(url, 'target-restart-before');
		const client = await getRuntimeLeaseClient();
		const before = await client.evaluate(async (targetTabId) => chrome.runtime.sendMessage({
			protocolVersion: 2, requestId: crypto.randomUUID(), type: 'spectra.control.snapshot.get',
			payload: { tabId: targetTabId }, tabId: targetTabId,
		}), tabId);
		expect(before.ok).toBe(true);
		expect(before.data?.fields.volumeBase?.actual).toBe(40);
		const neutral = await submitPopupControlIntent(tabId, { requestedCoverage: 'full', patch: { boost: 1 } });
		expect(neutral.ok).toBe(true);
		await releaseSmokeRuntime(lease);
		await eventually(() => readContentBootstrapStatus(url), status => !status.ready, 'runtime fully released');
		await fixturePage.evaluate(async (reuse) => {
			const old = document.querySelector<HTMLVideoElement>('#v');
			if (!old) throw new Error('Old presentation is missing');
			const next = old.cloneNode(true) as HTMLVideoElement;
			old.pause();
			old.remove();
			document.querySelector('#old-preview')?.remove();
			if (reuse) {
				const preview = document.createElement('video');
				preview.id = 'inactive-preview';
				preview.style.display = 'none';
				document.body.prepend(preview);
			}
			document.body.append(next);
			next.volume = 0.4;
			await next.play();
		}, mode === 'reused');
		const afterLease = await acquireSmokeRuntime(url, 'target-restart-after');
		await fixturePage.bringToFront();
		await fixturePage.keyboard.down('Alt');
		await fixturePage.keyboard.press('ArrowUp');
		await fixturePage.keyboard.up('Alt');
		const read = () => fixturePage.evaluate(() => ({
			presentation: document.querySelector<HTMLVideoElement>('#v')?.volume,
			preview: document.querySelector<HTMLVideoElement>('#inactive-preview')?.volume,
		}));
		try {
			await eventually(read, state => state.presentation !== undefined && state.presentation > 0.4,
				'volume shortcut reaches the rebuilt runtime selected presentation');
		} catch (error) {
			console.log(JSON.stringify({ mode, physical: await read(), stored: await storedSummary(tabId) }));
			throw error;
		}
		console.log(JSON.stringify({ mode, physical: await read(), stored: await storedSummary(tabId) }));
		if (mode === 'reused') expect((await read()).preview).toBe(1);
		await releaseSmokeRuntime(afterLease);
	}, 40_000);
	test('follows the broadcast native volume while another player owns control', async () => {
		await fixturePage.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
		const tabId = await getTabId(fixturePage.url());
		// The finite player the route left behind is playing and visible, so it is
		// the control owner. This is the state right after an SPA mounts a live page.
		await fixturePage.evaluate(async bytes => {
			const owner = document.querySelector<HTMLVideoElement>('#v');
			if (!owner) throw new Error('Fixture player missing');
			owner.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px';
			owner.src = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: 'audio/wav' }));
			owner.loop = true; owner.volume = 0.8; owner.muted = false;
			await owner.play();
		}, [...SMOKE_TONE_WAV]);
		await fixturePage.bringToFront();
		// One extension gesture lights the badge and records durable usage.
		await submitPopupControlIntent(tabId, { patch: { volumeBase: 80 } });
		expect(await eventually(() => readBadgeText(tabId), text => text === '80', 'finite owner badge'))
			.toBe('80');

		// The live route mounts a broadcast painted through a canvas: the <video>
		// keeps a 0x0 box and stays parked paused, so it never becomes the control
		// owner. Its native volume gesture still has to reach the badge.
		await fixturePage.evaluate(async () => {
			const live = document.createElement('video');
			live.id = 'broadcast';
			live.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0';
			const canvas = document.createElement('canvas');
			canvas.width = 320; canvas.height = 180;
			canvas.getContext('2d')?.fillRect(0, 0, 320, 180);
			const stream = canvas.captureStream(1);
			const context = new AudioContext();
			const oscillator = context.createOscillator();
			const destination = context.createMediaStreamDestination();
			oscillator.connect(destination); oscillator.start();
			await context.resume();
			for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
			live.srcObject = stream;
			live.volume = 0.2; live.muted = false;
			document.body.append(live);
		});
		await eventually(
			() => fixturePage.evaluate(() => document.querySelector<HTMLVideoElement>('#broadcast')?.duration),
			duration => duration === Number.POSITIVE_INFINITY,
			'broadcast timeline',
		);
		await fixturePage.evaluate(() => {
			const live = document.querySelector<HTMLVideoElement>('#broadcast');
			if (!live) throw new Error('Broadcast player missing');
			live.volume = 0.37;
		});
		expect(await eventually(() => readBadgeText(tabId), text => text === '37', 'broadcast native volume badge'))
			.toBe('37');
	}, 90_000);
});

function storedSummary(tabId: number): Promise<unknown> {
	return evaluateServiceWorker(async (targetTabId) => {
		const key = `spectra.control.tab.${targetTabId}`;
		const stored = (await chrome.storage.local.get(key))[key] as {
			activeMedia?: unknown; mediaObservation?: unknown; fields?: { boost?: unknown; volumeBase?: unknown };
		} | undefined;
		return { target: stored?.activeMedia, sample: stored?.mediaObservation,
			boost: stored?.fields?.boost, volumeBase: stored?.fields?.volumeBase };
	}, tabId);
}
