// goal: prove the shipped extension and Huya's own controls stay in sync in both directions
// inv: real-site gated case; real pointer input on the site's own widgets, real toolbar popup,
//      the shipped control snapshot and the page's own DOM are the only oracles
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CDPSession, Page } from 'puppeteer';
import { launchPuppeteerBrowser } from '../../../../scripts/browser-driver';
import {
	browser, closeActionPopup, evaluateServiceWorker, eventually, extensionId, getTabId,
	prepareSmokeSession, readBadgeText, startSmokeSession, teardownSmokeSession,
} from './harness';

const SITE_SOUND_BUTTON = '#player-sound-btn';
const SITE_PLAY_BUTTON = '#player-btn';
const SITE_VOLUME_TRACK = '.sound-progress';
const SITE_VOLUME_HANDLE = '.sound-btn';
const SITE_VOLUME_BAR = '.sound-bar';

type SiteVolume = {
	barWidth: number;
	trackWidth: number;
	elementVolume: number;
	buttonClass: string;
	playTitle: string;
	paused: boolean;
};

describe('built extension Huya native control parity', () => {
	beforeEach(async () => {
		const options = await prepareSmokeSession();
		await startSmokeSession(await launchPuppeteerBrowser({ ...options, ignoreDefaultArgs: ['--mute-audio'] }, {
			owner: 'apps/extension-spectra/test/smoke/huya-native-parity.spec.ts',
			profile: { kind: 'temporary', prefix: 'spectra-smoke-', isolated: true },
		}));
	}, 60_000);
	afterEach(teardownSmokeSession);

	test.skipIf(!process.env.SPECTRA_HUYA_PARITY_URL)(
		'pauses without a readback mismatch and mirrors its volume to and from the site UI',
		async () => {
			const liveUrl = process.env.SPECTRA_HUYA_PARITY_URL?.trim();
			if (!liveUrl || new URL(liveUrl).protocol !== 'https:') throw new Error('A public HTTPS Huya room is required');
			const page = await browser.newPage();
			const diagnostics: string[] = [];
			page.on('console', message => {
				if (message.text().includes('SPECTRA')) diagnostics.push(message.text());
			});
			const workerTarget = browser.targets().find(target => target.type() === 'service_worker'
				&& target.url().startsWith(`chrome-extension://${extensionId}/`));
			const workerSession = await workerTarget?.createCDPSession();
			await workerSession?.send('Runtime.enable');
			workerSession?.on('Runtime.exceptionThrown', event => {
				diagnostics.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text);
			});
			workerSession?.on('Runtime.consoleAPICalled', event => {
				if (event.type === 'error' || event.type === 'warning') {
					diagnostics.push(event.args.map(arg => String(arg.value ?? arg.description)).join(' '));
				}
			});
			let popup: Page | null = null;
			let session: CDPSession | null = null;
			try {
				await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
				await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
				await page.waitForFunction(() => {
					const video = document.querySelector('#hy-video') as HTMLMediaElement | null;
					return video && !video.paused && video.readyState >= 2
						&& document.querySelector('#player-btn')?.getAttribute('title')?.includes('暂停观看');
				}, { timeout: 60_000 });
				const tabId = await getTabId(page.url());

				const readSite = (): Promise<SiteVolume> => page.evaluate(() => {
					const bar = document.querySelector('.sound-bar');
					const video = document.querySelector('#hy-video') as HTMLMediaElement | null;
					const sound = document.querySelector('#player-sound-btn');
					const play = document.querySelector('#player-btn');
					return { barWidth: bar?.getBoundingClientRect().width ?? 0,
						trackWidth: document.querySelector('.sound-progress')?.getBoundingClientRect().width ?? 0,
						elementVolume: video?.volume ?? -1,
						buttonClass: sound?.className ?? '',
						playTitle: play?.getAttribute('title') ?? '',
						paused: video?.paused ?? true };
				});
				const readPlaying = () => evaluateServiceWorker(async id => {
					const key = `spectra.control.tab.${id}`;
					const snapshot = (await chrome.storage.local.get(key))[key];
					return snapshot?.fields?.playing ?? null;
				}, tabId);
				const readVolume = () => evaluateServiceWorker(async id => {
					const key = `spectra.control.tab.${id}`;
					const snapshot = (await chrome.storage.local.get(key))[key];
					return snapshot?.fields?.volumeBase ?? null;
				}, tabId);
				// The site's own controls must exist before any of the gestures below
				// can be treated as parity evidence.
				expect(await page.$eval(SITE_PLAY_BUTTON,
					button => button.getAttribute('title') ?? '')).toContain('暂停观看');

				// Huya keeps its control bar below the initial viewport, reveals that
				// bar only while the pointer is over the player, and reveals the volume
				// slider only while the pointer is over the sound button. The gesture
				// sequence below is the one proven by the observation-only probe.
				await page.evaluate(() => window.scrollTo(0, 420));
				await new Promise(resolve => setTimeout(resolve, 700));
				const player = await page.$('#player-wrap');
				const playerBox = await player?.boundingBox();
				if (playerBox) {
					await page.mouse.move(playerBox.x + playerBox.width / 2,
						playerBox.y + playerBox.height / 2);
					await new Promise(resolve => setTimeout(resolve, 350));
				}
				await (await page.$(SITE_SOUND_BUTTON))?.hover();
				await new Promise(resolve => setTimeout(resolve, 900));
				expect(await page.$eval(SITE_VOLUME_BAR,
					bar => bar.getBoundingClientRect().width)).toBeGreaterThan(0);

				// First Popup control precedes every site volume or playback gesture.
				await evaluateServiceWorker(() => {
					const witness: unknown[] = [];
					Object.assign(globalThis, { huyaPopupPortWitness: witness });
					chrome.runtime.onConnect.addListener(port => {
						port.onMessage.addListener(message => witness.push({ name: port.name, message }));
						const post = port.postMessage.bind(port);
						port.postMessage = message => {
							witness.push({ name: port.name, direction: 'out', message });
							post(message);
						};
					});
					chrome.runtime.onMessage.addListener(message => {
						if (message.type?.includes('control.') && message.payload?.source === 'popup') {
							witness.push({ name: 'popup-rpc', message });
						}
					});
				});
				await page.bringToFront();
				const known = new Set(browser.targets());
				const pending = browser.waitForTarget(target => !known.has(target)
					&& target.url().startsWith(`chrome-extension://${extensionId}/popup.html`), { timeout: 20_000 });
				session = await browser.target().createCDPSession();
				const { targetInfos } = await session.send('Target.getTargets',
					{ filter: [{ type: 'tab', exclude: false }] });
				const tab = targetInfos.find(candidate => candidate.url === page.url());
				if (!tab) throw new Error('Huya tab target is missing');
				await session.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
				await session.detach(); session = null;
				popup = await (await pending).asPage();
				popup.on('console', message => diagnostics.push(message.text()));
				const card = `.glass-card[data-tab-id="${tabId}"]`;
				await popup.waitForSelector(`${card} .btn-pause`, { timeout: 20_000 });
				await popup.waitForFunction(selector => {
					const button = document.querySelector(`${selector} .btn-pause`);
					return button && button.getAttribute('aria-busy') !== 'true'
						&& button.getAttribute('aria-pressed') !== 'mixed';
				}, { timeout: 20_000 }, card);

				const slider = `${card} .vol-slider`;
				await popup.$eval(slider, element => {
					const input = element as HTMLInputElement;
					const events: unknown[] = [];
					for (const type of ['pointerdown', 'input', 'change', 'pointerup']) {
						input.addEventListener(type, event => {
							events.push({ type: event.type, trusted: event.isTrusted, value: input.value });
							input.dataset.gestureTrace = JSON.stringify(events);
						});
					}
				});
				const sliderBox = await popup.$eval(slider, element => {
					const rect = element.getBoundingClientRect();
					const input = element as HTMLInputElement;
					return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
						min: Number(input.min), max: Number(input.max), value: Number(input.value) };
				});
				const sliderX = (level: number) => sliderBox.x + 11
					+ (sliderBox.width - 22) * (level - sliderBox.min) / (sliderBox.max - sliderBox.min);
				await popup.mouse.move(sliderX(sliderBox.value), sliderBox.y + sliderBox.height / 2);
				await popup.mouse.down();
				await popup.mouse.move(sliderX(70), sliderBox.y + sliderBox.height / 2, { steps: 12 });
				await popup.mouse.up();
				const firstVolume = await eventually(readVolume, value => value?.phase === 'applied'
					&& value.controlled && Math.abs(Number(value.actual) - 70) <= 6,
					'first Popup volume drag succeeds without a pause/play warm-up').catch(async error => {
					const view = await popup?.$eval(slider, element => {
						const input = element as HTMLInputElement;
						return { value: input.value, min: input.min, max: input.max, disabled: input.disabled,
							gestureTrace: input.dataset.gestureTrace, card: input.closest('.glass-card')?.textContent };
					});
					const ports = await evaluateServiceWorker(() => Reflect.get(globalThis, 'huyaPopupPortWitness'));
					throw new Error(`${String(error)}; diagnostics=${JSON.stringify({ sliderBox, view, ports, site: await readSite(), diagnostics })}`);
				});
				expect(firstVolume?.lastError).toBeNull();
				const firstLevel = Number(firstVolume?.actual);
				console.log(JSON.stringify({ huyaFirstControl: { firstVolume, site: await readSite(),
					ports: await evaluateServiceWorker(() => Reflect.get(globalThis, 'huyaPopupPortWitness')),
					media: await page.$eval('#hy-video', element => {
						const video = element as HTMLVideoElement;
						return { src: video.currentSrc, readyState: video.readyState,
							streamTracks: video.srcObject instanceof MediaStream
								? video.srcObject.getTracks().map(track => ({ kind: track.kind, readyState: track.readyState })) : null };
					}) } }));
				const firstSite = await eventually(readSite,
					value => Math.abs(value.elementVolume * 100 - firstLevel) <= 6
						&& Math.abs(value.barWidth / value.trackWidth * 100 - firstLevel) <= 6,
					'first Popup drag reaches the Huya player and its own volume bar');

				await popup.click(`${card} .btn-pause`);
				const pausedState = await eventually(readPlaying,
					value => value?.actual === false, 'extension pause ACK is applied');
				expect(pausedState?.phase).toBe('applied');
				expect(pausedState?.lastError).toBeNull();
				const sitePaused = await eventually(readSite, value => value.paused,
					'Huya media element is paused');
				expect(sitePaused.playTitle).toContain('开始观看');

				await popup.click(`${card} .btn-pause`);
				const resumedState = await eventually(readPlaying,
					value => value?.actual === true, 'extension resume ACK is applied');
				expect(resumedState?.phase).toBe('applied');
				expect(resumedState?.lastError).toBeNull();
				await eventually(readSite, value => !value.paused, 'Huya media element resumes');
				for (let sample = 0; sample < 5; sample += 1) {
					await new Promise(resolve => setTimeout(resolve, 300));
					const volume = await readVolume();
					expect(volume?.phase).toBe('applied');
					expect(volume?.lastError).toBeNull();
					expect(Math.abs(Number(volume?.actual) - firstLevel)).toBeLessThanOrEqual(6);
					const site = await readSite();
					expect(Math.abs(site.elementVolume * 100 - firstLevel)).toBeLessThanOrEqual(6);
					expect(Math.abs(site.barWidth / site.trackWidth * 100 - firstLevel)).toBeLessThanOrEqual(6);
				}

				// 3. Extension -> site: drive the shipped slider with real keys.
				const step = await popup.$eval(slider, element => Number((element as HTMLInputElement).step));
				expect(step).toBeGreaterThan(0);
				await popup.focus(slider);
				await popup.keyboard.press('Home');
				for (let index = 0; index < 70 / step; index += 1) await popup.keyboard.press('ArrowRight');
				const extensionAfterSlider = await eventually(readVolume,
					value => value?.phase === 'applied' && value.controlled
						&& value.revision > firstVolume.revision && Math.abs(Number(value.actual) - 70) <= 6,
					'extension slider commits its own new level');
				expect(extensionAfterSlider.lastError).toBeNull();
				const siteAfterSlider = await eventually(readSite,
					value => Math.abs(value.elementVolume * 100 - 70) <= 6
						&& Math.abs(value.barWidth / value.trackWidth * 100 - 70) <= 6,
					'Huya native volume bar follows the extension slider');
				expect(await eventually(() => readBadgeText(tabId),
					text => Math.abs(Number(text) - Number(extensionAfterSlider?.actual)) <= 6,
					'badge shows the same level as the site and the slider')).toBeTruthy();
				expect(await popup.$eval(slider,
					element => Number((element as HTMLInputElement).value))).toBe(70);

				await closeActionPopup(popup); popup = null;
				await page.bringToFront();
				await (await page.$(SITE_SOUND_BUTTON))?.hover();
				await page.waitForFunction(() => (document.querySelector('.sound-progress')?.getBoundingClientRect().width ?? 0) > 24);
				const track = await page.$eval(SITE_VOLUME_TRACK, element => {
					const rect = element.getBoundingClientRect();
					return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
				});
				const handle = await page.$eval(SITE_VOLUME_HANDLE, element => {
					const rect = element.getBoundingClientRect();
					return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
				});
				expect(handle.width).toBeGreaterThan(0);
				await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
				await page.mouse.down();
				await page.mouse.move(track.x + track.width * 0.2, handle.y + handle.height / 2, { steps: 10 });
				await page.mouse.up();
				const siteAfterGesture = await eventually(readSite, value => value.elementVolume > 0
					&& value.elementVolume < 0.45 && Math.abs(value.barWidth / value.trackWidth - value.elementVolume) <= 0.06,
				'Huya native gesture reaches both media and site volume bar');
				const extensionAfterGesture = await eventually(readVolume, value => value?.phase === 'applied'
					&& Math.abs(Number(value.actual) - siteAfterGesture.elementVolume * 100) <= 3,
				'extension follows the site native volume gesture');
				await eventually(() => readBadgeText(tabId), text => Math.abs(Number(text)
					- siteAfterGesture.elementVolume * 100) <= 3, 'native gesture updates badge with Popup closed');

				console.log(JSON.stringify({ huyaNativeParity: {
					url: page.url(), tabId,
					firstDrag: { snapshot: firstVolume, site: firstSite, sliderBox },
					siteGesture: { elementVolume: siteAfterGesture.elementVolume,
						barWidth: siteAfterGesture.barWidth,
						extensionVolume: extensionAfterGesture?.actual },
					pause: { phase: pausedState?.phase, lastError: pausedState?.lastError,
						sitePaused: sitePaused.paused, playTitle: sitePaused.playTitle },
					resume: { phase: resumedState?.phase, lastError: resumedState?.lastError },
					extensionSlider: { extensionVolume: extensionAfterSlider?.actual,
						elementVolume: siteAfterSlider.elementVolume,
						barWidth: siteAfterSlider.barWidth },
				} }));
			} catch (error) {
				const view = popup && !popup.isClosed() ? await popup.evaluate(() => ({
					cards: [...document.querySelectorAll('.glass-card')].map(card => ({
						class: card.className, tabId: (card as HTMLElement).dataset.tabId,
						button: card.querySelector('.btn-pause')?.outerHTML,
						slider: (card.querySelector('.vol-slider') as HTMLInputElement | null)?.value,
					})), alerts: [...document.querySelectorAll('.popup-toast-error, [role="alert"]')].map(node => node.textContent),
				})) : null;
				console.error(JSON.stringify({ diagnostics, view,
					ports: await evaluateServiceWorker(() => Reflect.get(globalThis, 'huyaPopupPortWitness')) }));
				throw error;
			} finally {
				await workerSession?.detach().catch(() => undefined);
				await session?.detach().catch(() => undefined);
				if (popup) await closeActionPopup(popup).catch(() => undefined);
				await page.close();
			}
		}, 180_000);
});
