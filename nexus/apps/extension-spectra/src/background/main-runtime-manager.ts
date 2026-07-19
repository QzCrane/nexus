// goal: one-shot, allowlisted official site API fallback with privileged readback

import {
	matchSiteNativeAdapter,
	type ControlValues,
	type SiteNativeAdapterId,
	type SiteNativeControlField,
} from '@nexus/contracts';
import { swLog } from '../shared/logger';

export interface MainSiteControlRequest<K extends SiteNativeControlField = SiteNativeControlField> {
	tabId: number;
	documentId: string;
	generation: number;
	intentId: string;
	field: K;
	value: ControlValues[K];
}

export interface MainSiteControlResult<K extends SiteNativeControlField = SiteNativeControlField> {
	adapter: SiteNativeAdapterId;
	field: K;
	before: ControlValues[K];
	actual: ControlValues[K];
}

interface MainExecutionResult {
	ok: boolean;
	before?: unknown;
	actual?: unknown;
	error?: string;
}

type SerializedMainExecutor = () => void;

// This function is serialized by Chrome and executed in MAIN. It is purposely
// self-contained: it patches no constructor/prototype/descriptor, installs no
// listener, and returns the official getter readback in the same invocation.
async function applyYouTubeOfficialControl(field: string, value: unknown): Promise<MainExecutionResult> {
	const candidate = document.querySelector('#movie_player') as Element & {
		setPlaybackRate?(rate: number): void;
		getPlaybackRate?(): number;
		setVolume?(volume: number): void;
		getVolume?(): number;
		isMuted?(): boolean;
		mute?(): void;
		unMute?(): void;
	} | null;
	if (!candidate) return { ok: false, error: 'The official player API is unavailable' };
	try {
		const boundary = () => Promise.race([
			new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
			new Promise<void>((resolve) => setTimeout(resolve, 50)),
		]);
		const settle = async (): Promise<void> => {
			await boundary();
			await boundary();
			await new Promise<void>((resolve) => setTimeout(resolve, 64));
			await boundary();
			await boundary();
		};
		if (field === 'speed' && typeof value === 'number'
			&& candidate.setPlaybackRate && candidate.getPlaybackRate) {
			const before = candidate.getPlaybackRate();
			candidate.setPlaybackRate(value);
			await settle();
			const actual = candidate.getPlaybackRate();
			return Number.isFinite(actual) && Math.abs(actual - value) <= 0.005
				? { ok: true, before, actual }
				: { ok: false, error: `Playback-rate readback mismatch (${String(actual)})` };
		}
		if (field === 'volumeBase' && typeof value === 'number'
			&& candidate.setVolume && candidate.getVolume) {
			const before = candidate.getVolume();
			candidate.setVolume(value);
			await settle();
			const actual = candidate.getVolume();
			return Number.isFinite(actual) && Math.abs(actual - value) <= 1
				? { ok: true, before, actual }
				: { ok: false, error: `Volume readback mismatch (${String(actual)})` };
		}
		if (field === 'mediaMuted' && typeof value === 'boolean'
			&& candidate.isMuted && candidate.mute && candidate.unMute) {
			const before = candidate.isMuted();
			if (value) candidate.mute();
			else candidate.unMute();
			await settle();
			const actual = candidate.isMuted();
			return actual === value
				? { ok: true, before, actual }
				: { ok: false, error: `Mute readback mismatch (${String(actual)})` };
		}
		return { ok: false, error: `Official player API does not support ${field}` };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

// Chrome's current declaration models serialized MAIN functions as zero-arg
// callbacks even though MV3 supports `args`. Keeping the cast at this boundary
// preserves an exhaustive adapter -> executor map without weakening callers.
const SITE_NATIVE_EXECUTORS = {
	youtube: applyYouTubeOfficialControl as unknown as SerializedMainExecutor,
} satisfies Record<SiteNativeAdapterId, SerializedMainExecutor>;

function isActualValue<K extends SiteNativeControlField>(
	field: K,
	value: unknown,
): value is ControlValues[K] {
	if (field === 'mediaMuted') return typeof value === 'boolean';
	if (typeof value !== 'number' || !Number.isFinite(value)) return false;
	if (field === 'volumeBase') return value >= 0 && value <= 100;
	return value >= 0.1 && value <= 16;
}

export async function applyMainSiteControl<K extends SiteNativeControlField>(
	request: MainSiteControlRequest<K>,
): Promise<MainSiteControlResult<K>> {
	const frame = await chrome.webNavigation.getFrame({ tabId: request.tabId, frameId: 0 });
	if (!frame?.documentId || frame.documentId !== request.documentId) {
		throw new Error('Site-native control belongs to a stale document');
	}
	let hostname = '';
	try { hostname = new URL(frame.url).hostname; }
	catch { throw new Error('Site-native control requires a valid web origin'); }
	const adapter = matchSiteNativeAdapter(hostname, request.field);
	if (!adapter) throw new Error('No allowlisted official site API supports this control');

	const results = await chrome.scripting.executeScript({
		target: { tabId: request.tabId, documentIds: [request.documentId] },
		world: 'MAIN',
		func: SITE_NATIVE_EXECUTORS[adapter],
		args: [request.field, request.value],
	}) as unknown as Array<{
		documentId?: string;
		result?: MainExecutionResult;
	}>;
	const execution = results[0];
	if (!execution || execution.documentId && execution.documentId !== request.documentId) {
		throw new Error('Site-native result came from a stale document');
	}
	const result = execution.result as MainExecutionResult | undefined;
	if (!result?.ok
		|| !isActualValue(request.field, result.before)
		|| !isActualValue(request.field, result.actual)) {
		throw new Error(result?.error ?? 'Official site API returned an invalid readback');
	}
	return {
		adapter,
		field: request.field,
		before: result.before,
		actual: result.actual,
	};
}

let initialized = false;

export function initializeMainRuntimeManager(): void {
	if (initialized) return;
	initialized = true;
	swLog.debug('[MAIN] one-shot allowlisted site API fallback initialized');
}

// eff: sole owner of MAIN world content-script injection. upgrade-manager
// and runtime-loader must delegate here; no other module may carry the
// `world: 'MAIN'` literal.
export const MAIN_WORLD_CONTENT_FILES = [
	'content-fullscreen-bridge.js',
	'content-playback-rate-bridge.js',
] as const;

export async function injectMainBridges(
	tabId: number,
): Promise<void> {
	await chrome.scripting.executeScript({
		target: { tabId },
		files: ['content-fullscreen-bridge.js'],
		world: 'MAIN',
	});
	await chrome.scripting.executeScript({
		target: { tabId },
		files: ['content-playback-rate-bridge.js'],
		world: 'MAIN',
	});
}

export async function injectMainBootstrap(
	tabId: number,
): Promise<void> {
	await chrome.scripting.executeScript({
		target: { tabId },
		files: ['content-bootstrap.js'],
		world: 'ISOLATED',
	});
}
