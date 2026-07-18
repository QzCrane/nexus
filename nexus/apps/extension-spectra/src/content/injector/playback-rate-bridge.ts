// goal: execute player-observable playback-rate writes in the page's MAIN world

import {
	SPECTRA_PLAYBACK_RATE_EVENT,
	SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE,
	SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE,
	type SpectraPlaybackRateRequest,
	type SpectraPlaybackRateResult,
} from '../../shared/playback-rate-bridge';

interface MainPlaybackRateWindow extends Window {
	__SPECTRA_PLAYBACK_RATE_BRIDGE_V1__?: true;
}

const RATE_OPTION_SELECTOR = [
	'xg-playbackrate li',
	'.xgplayer-playbackrate li',
	'xg-playbackrate [role="menuitem"]',
	'.xgplayer-playbackrate [role="menuitem"]',
	'[class*="playbackrate"] [role="menuitemradio"]',
	'[class*="playback-rate"] [role="menuitemradio"]',
	'[class*="playbackrate"] [role="menuitem"]',
	'[class*="playback-rate"] [role="menuitem"]',
	'[class*="playbackrate"] [data-value]',
	'[class*="playback-rate"] [data-value]',
	'[data-rate]',
	'[data-speed]',
	'[data-playback-rate]',
].join(',');

const RATE_CONTROL_SELECTOR = [
	'xg-playbackrate',
	'.xgplayer-playbackrate',
	'[class*="playbackrate"]',
	'[class*="playback-rate"]',
	'[class*="playbackRate"]',
	'[class*="speed-menu"]',
	'[class*="speedMenu"]',
].join(',');

const RATE_OPTION_CHILD_SELECTOR = [
	'li',
	'button',
	'[role="menuitem"]',
	'[role="menuitemradio"]',
	'[data-value]',
	'[data-rate]',
	'[data-speed]',
	'[data-playback-rate]',
].join(',');

const RATE_CLICK_TARGET_SELECTOR = [
	'button',
	'li',
	'[role="menuitem"]',
	'[role="menuitemradio"]',
	'[role="option"]',
].join(',');

const RATE_TEXT_SCAN_LIMIT = 512;
const RATE_TEXT_LENGTH_LIMIT = 24;

const clickedRateOptions = new WeakMap<HTMLElement, number>();
const deferredTextRateOptions = new Set<HTMLElement>();
let latestRateRequest: { element: HTMLMediaElement; speed: number } | null = null;
let rateMenuObserver: MutationObserver | null = null;
let rateMenuSyncQueued = false;

function parseRateOption(option: HTMLElement): number | null {
	for (const name of ['rate', 'data-rate', 'data-speed', 'data-playback-rate', 'data-value']) {
		const raw = option.getAttribute(name);
		if (!raw) continue;
		const value = Number.parseFloat(raw);
		if (Number.isFinite(value) && value >= 0.1 && value <= 16) return value;
	}
	const text = option.textContent?.trim().replace(/\s+/gu, '') ?? '';
	if (/^(?:正常|标准|原速)$/u.test(text)) return 1;
	const match = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*(?:x|倍)(?:$|[^a-z\d])/iu.exec(text);
	if (!match) return null;
	const value = Number.parseFloat(match[1]!);
	return Number.isFinite(value) && value >= 0.1 && value <= 16 ? value : null;
}

function isRendered(element: HTMLElement): boolean {
	const style = getComputedStyle(element);
	return style.display !== 'none'
		&& style.visibility !== 'hidden'
		&& Number.parseFloat(style.opacity || '1') > 0;
}

function compactTextLength(element: HTMLElement): number {
	return (element.textContent ?? '').replace(/\s+/gu, '').length;
}

function discoverTextRateOptions(roots: Iterable<Element>): HTMLElement[] {
	const scanned = new Set<HTMLElement>();
	for (const root of roots) {
		if (scanned.size >= RATE_TEXT_SCAN_LIMIT) break;
		if (root instanceof HTMLElement) scanned.add(root);
		for (const descendant of root.querySelectorAll<HTMLElement>('*')) {
			if (scanned.size >= RATE_TEXT_SCAN_LIMIT) break;
			scanned.add(descendant);
		}
	}

	const candidates = new Set<HTMLElement>();
	for (const leaf of scanned) {
		if (leaf.children.length > 0
			|| compactTextLength(leaf) > RATE_TEXT_LENGTH_LIMIT
			|| parseRateOption(leaf) === null) continue;
		const explicitTarget = leaf.closest<HTMLElement>(RATE_CLICK_TARGET_SELECTOR);
		if (explicitTarget && compactTextLength(explicitTarget) <= RATE_TEXT_LENGTH_LIMIT) {
			candidates.add(explicitTarget);
			continue;
		}
		const parent = leaf.parentElement;
		if (!parent) continue;
		const directRateChildren = [...parent.children].filter((child): child is HTMLElement => (
			child instanceof HTMLElement
			&& child.children.length === 0
			&& compactTextLength(child) <= RATE_TEXT_LENGTH_LIMIT
			&& parseRateOption(child) !== null
		));
		const target = directRateChildren.length >= 2 ? leaf : parent;
		if (compactTextLength(target) <= RATE_TEXT_LENGTH_LIMIT) candidates.add(target);
	}

	const grouped = new Map<HTMLElement, Map<number, HTMLElement>>();
	for (const candidate of candidates) {
		const rate = parseRateOption(candidate);
		if (rate === null || !candidate.parentElement || !candidate.isConnected || !isRendered(candidate)) continue;
		const group = grouped.get(candidate.parentElement) ?? new Map<number, HTMLElement>();
		if (!group.has(rate)) group.set(rate, candidate);
		grouped.set(candidate.parentElement, group);
	}
	const options: HTMLElement[] = [];
	for (const group of grouped.values()) {
		if (group.size < 2) continue;
		options.push(...group.values());
	}
	return options;
}

function rememberTextRateOptions(roots: Iterable<Element>): boolean {
	for (const option of [...deferredTextRateOptions]) {
		if (!option.isConnected) deferredTextRateOptions.delete(option);
	}
	const discovered = discoverTextRateOptions(roots);
	for (const option of discovered) deferredTextRateOptions.add(option);
	return discovered.length > 0;
}

function collectRateOptions(element: HTMLMediaElement): HTMLElement[] {
	const player = element.closest('.xgplayer') ?? element.closest('xg-video-container');
	if (!player) return [];
	const options = new Set<HTMLElement>(player.querySelectorAll<HTMLElement>(RATE_OPTION_SELECTOR));

	// XGPlayer/React menus are frequently mounted into a body-level portal only
	// after the user opens the speed control. Include a rendered portal only when
	// it contains at least two valid rate choices, avoiding unrelated data-value UI.
	for (const control of document.querySelectorAll<HTMLElement>(RATE_CONTROL_SELECTOR)) {
		if (!player.contains(control) && !isRendered(control)) continue;
		const children = [...control.querySelectorAll<HTMLElement>(RATE_OPTION_CHILD_SELECTOR)]
			.filter((option) => parseRateOption(option) !== null);
		if (new Set(children.map((option) => parseRateOption(option))).size < 2) continue;
		for (const option of children) options.add(option);
	}

	const globalOptions = [...document.querySelectorAll<HTMLElement>(RATE_OPTION_SELECTOR)]
		.filter((option) => !player.contains(option) && isRendered(option));
	const grouped = new Map<HTMLElement, HTMLElement[]>();
	for (const option of globalOptions) {
		if (parseRateOption(option) === null || !option.parentElement) continue;
		const group = grouped.get(option.parentElement) ?? [];
		group.push(option);
		grouped.set(option.parentElement, group);
	}
	for (const group of grouped.values()) {
		if (new Set(group.map((option) => parseRateOption(option))).size < 2) continue;
		for (const option of group) options.add(option);
	}
	for (const option of [...deferredTextRateOptions]) {
		if (!option.isConnected) {
			deferredTextRateOptions.delete(option);
			continue;
		}
		if (isRendered(option)) options.add(option);
	}
	return [...options];
}

function attachedPlayerControllers(element: HTMLMediaElement, player: Element): object[] {
	const controllers = new Set<object>();
	for (const host of [element, player, player.parentElement].filter(Boolean) as object[]) {
		for (const key of Object.getOwnPropertyNames(host)) {
			if (!/(?:^|_)(?:xg)?player(?:_|$)/iu.test(key)) continue;
			const value = Object.getOwnPropertyDescriptor(host, key)?.value;
			if (value && typeof value === 'object') controllers.add(value);
		}
	}
	return [...controllers].filter((candidate) => {
		const controller = candidate as Record<string, unknown>;
		return controller.video === element
			|| controller.media === element
			|| controller.root === player
			|| controller.el === player
			|| /player/iu.test(candidate.constructor?.name ?? '');
	});
}

function synchronizeAttachedPlayerController(
	element: HTMLMediaElement,
	player: Element,
	speed: number,
): boolean {
	for (const candidate of attachedPlayerControllers(element, player)) {
		const controller = candidate as Record<string, unknown>;
		for (const name of ['setPlaybackRate', 'setPlaybackRateByUser', 'changePlaybackRate']) {
			const setter = controller[name];
			if (typeof setter !== 'function') continue;
			(setter as (this: object, rate: number) => unknown).call(candidate, speed);
			return true;
		}
		if ('playbackRate' in controller && typeof controller.playbackRate === 'number') {
			controller.playbackRate = speed;
			return true;
		}
	}
	return false;
}

function synchronizePlayerRateUI(
	element: HTMLMediaElement,
	speed: number,
	useAttachedController = false,
): void {
	const player = element.closest('.xgplayer') ?? element.closest('xg-video-container');
	if (!player) return;
	player.setAttribute('data-spectra-playback-rate', String(speed));
	if (useAttachedController) synchronizeAttachedPlayerController(element, player, speed);
	const options = collectRateOptions(element);
	const selected = options.find((option) => {
		const rate = parseRateOption(option);
		return rate !== null && Math.abs(rate - speed) <= 0.005;
	});
	if (selected && clickedRateOptions.get(selected) !== speed) {
		// Dispatch through the player's own controller so React/XGPlayer state,
		// labels and portalled menus observe the same change as a real selection.
		clickedRateOptions.set(selected, speed);
		selected.click();
	}
	const activeClasses = ['selected', 'active', 'xgplayer-active']
		.filter((name) => options.some((option) => option.classList.contains(name)));
	for (const option of options) {
		const rate = parseRateOption(option);
		const active = rate !== null && Math.abs(rate - speed) <= 0.005;
		option.setAttribute('aria-selected', String(active));
		if (option.hasAttribute('aria-checked')) option.setAttribute('aria-checked', String(active));
		for (const name of activeClasses) option.classList.toggle(name, active);
	}

	const controls = new Set<HTMLElement>(player.querySelectorAll<HTMLElement>(RATE_CONTROL_SELECTOR));
	if (selected) {
		const control = selected.closest<HTMLElement>(RATE_CONTROL_SELECTOR);
		if (control) controls.add(control);
	}
	for (const control of controls) {
		for (const label of control.querySelectorAll<HTMLElement>(
			'.name span, [class*="name"] span, [class*="label"], [class*="value"]',
		)) {
			if (label.children.length > 0 || parseRateOption(label) === null) continue;
			label.textContent = `${speed}x`;
		}
	}
}

function ensureDeferredRateMenuSync(): void {
	if (rateMenuObserver || !document.documentElement) return;
	rateMenuObserver = new MutationObserver((mutations) => {
		const roots: Element[] = [];
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (!(node instanceof Element)) continue;
				roots.push(node);
				const parent = node.parentElement;
				if (parent && parent !== document.body && parent !== document.documentElement) {
					roots.push(parent);
				}
			}
		}
		rememberTextRateOptions(roots);
		if (rateMenuSyncQueued) return;
		rateMenuSyncQueued = true;
		queueMicrotask(() => {
			rateMenuSyncQueued = false;
			const current = latestRateRequest;
			if (!current?.element.isConnected) return;
			synchronizePlayerRateUI(current.element, current.speed);
		});
	});
	rateMenuObserver.observe(document.documentElement, { childList: true, subtree: true });
	if (document.body) {
		rememberTextRateOptions([...document.body.children].reverse().slice(0, 24));
	}
}

function decodeRequest(element: HTMLMediaElement): SpectraPlaybackRateRequest | null {
	const encoded = element.getAttribute(SPECTRA_PLAYBACK_RATE_REQUEST_ATTRIBUTE);
	if (!encoded) return null;
	try {
		const request = JSON.parse(encoded) as Partial<SpectraPlaybackRateRequest>;
		return typeof request.requestId === 'string'
			&& request.requestId.length > 0
			&& typeof request.speed === 'number'
			&& Number.isFinite(request.speed)
			&& request.speed >= 0.1
			&& request.speed <= 16
			? { requestId: request.requestId, speed: request.speed }
			: null;
	} catch {
		return null;
	}
}

function onPlaybackRateRequest(event: Event): void {
	const element = event.target;
	if (!(element instanceof HTMLMediaElement)
		|| !element.closest('.xgplayer, xg-video-container')) return;
	const request = decodeRequest(element);
	if (!request) return;
	let result: SpectraPlaybackRateResult;
	try {
		latestRateRequest = { element, speed: request.speed };
		ensureDeferredRateMenuSync();
		synchronizePlayerRateUI(element, request.speed, true);
		if (Math.abs(element.defaultPlaybackRate - element.playbackRate) <= 0.005) {
			element.defaultPlaybackRate = request.speed;
		}
		element.playbackRate = request.speed;
		synchronizePlayerRateUI(element, element.playbackRate);
		result = { requestId: request.requestId, actual: element.playbackRate };
	} catch (error) {
		result = {
			requestId: request.requestId,
			actual: null,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	element.setAttribute(SPECTRA_PLAYBACK_RATE_RESULT_ATTRIBUTE, JSON.stringify(result));
}

const mainWindow = window as MainPlaybackRateWindow;
if (!mainWindow.__SPECTRA_PLAYBACK_RATE_BRIDGE_V1__) {
	mainWindow.__SPECTRA_PLAYBACK_RATE_BRIDGE_V1__ = true;
	document.addEventListener(SPECTRA_PLAYBACK_RATE_EVENT, onPlaybackRateRequest, true);
	document.addEventListener('ratechange', (event) => {
		const element = event.target;
		if (!(element instanceof HTMLMediaElement)
			|| !element.closest('.xgplayer, xg-video-container')) return;
		latestRateRequest = { element, speed: element.playbackRate };
		ensureDeferredRateMenuSync();
		synchronizePlayerRateUI(element, element.playbackRate);
	}, true);
}
