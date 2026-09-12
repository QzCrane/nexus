// goal: MSE (MediaSource Extensions) player with streaming support
// eff: Combines video+audio m4s streams, supports incremental loading

import { fetchArrayBufferWithProxy } from '../utils/proxy-utils';
import type { OwnedMSESession } from './mse-session-owner';
import type { HoverZoomProxyCapability } from '../../rules/network-capabilities';

const LOG_TAG = '[HALO:HoverZoom:MSEPlayer]';
const VIDEO_MIME = 'video/mp4; codecs="avc1.640028"';
const AUDIO_MIME = 'audio/mp4; codecs="mp4a.40.2"';
const INITIAL_CHUNK = 768 * 1024;    // 768KB for fast first frame
const CHUNK_SIZE = 2 * 1024 * 1024;  // 2MB for subsequent chunks

interface MSESession {
	mediaSource: MediaSource;
	videoBuffer: SourceBuffer | null;
	audioBuffer: SourceBuffer | null;
	abortController: AbortController;
	aborted: boolean;
	videoOffset: number;
	audioOffset: number;
	videoEnded: boolean;
	audioEnded: boolean;
}

interface MSEPlayerDependencies {
	isSupported: () => boolean;
	createMediaSource: () => MediaSource;
	createObjectUrl: (source: MediaSource) => string;
	revokeObjectUrl: (url: string) => void;
	fetchSegment: (
		url: string,
		headers?: Record<string, string>,
		signal?: AbortSignal,
	) => Promise<ArrayBuffer>;
}

export function isMSESupported(): boolean {
	return 'MediaSource' in window && MediaSource.isTypeSupported(VIDEO_MIME);
}

function createAbortError(): Error {
	const error = new Error('MSE session was disposed');
	error.name = 'AbortError';
	return error;
}

function rejectIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw createAbortError();
}

function waitForAbortable<T>(
	operation: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	if (signal.aborted) return Promise.reject(createAbortError());

	return new Promise<T>((resolve, reject) => {
		const cleanup = () => signal.removeEventListener('abort', onAbort);
		const onAbort = () => {
			cleanup();
			reject(createAbortError());
		};
		signal.addEventListener('abort', onAbort, { once: true });
		operation.then(
			(value) => {
				cleanup();
				resolve(value);
			},
			(error: unknown) => {
				cleanup();
				reject(error);
			},
		);
	});
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(createAbortError());

	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, delayMs);
		const cleanup = () => {
			clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
		};
		const onAbort = () => {
			cleanup();
			reject(createAbortError());
		};
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

async function appendBuffer(
	buffer: SourceBuffer,
	data: ArrayBuffer,
	session: MSESession,
): Promise<void> {
	const signal = session.abortController.signal;
	rejectIfAborted(signal);
	if (session.mediaSource.readyState !== 'open') return;
	if (buffer.updating) {
		return new Promise((resolve, reject) => {
			const cleanupListeners = () => {
				buffer.removeEventListener('updateend', onUpdateEnd);
				buffer.removeEventListener('error', onError);
				buffer.removeEventListener('abort', onBufferAbort);
				signal.removeEventListener('abort', onSessionAbort);
			};
			const onUpdateEnd = () => {
				cleanupListeners();
				void appendBuffer(buffer, data, session).then(resolve, reject);
			};
			const onError = (event: Event) => {
				cleanupListeners();
				reject(event);
			};
			const onBufferAbort = (event: Event) => {
				cleanupListeners();
				reject(event);
			};
			const onSessionAbort = () => {
				cleanupListeners();
				reject(createAbortError());
			};
			buffer.addEventListener('updateend', onUpdateEnd);
			buffer.addEventListener('error', onError);
			buffer.addEventListener('abort', onBufferAbort);
			signal.addEventListener('abort', onSessionAbort, { once: true });
		});
	}

	return new Promise((resolve, reject) => {
		const cleanupListeners = () => {
			buffer.removeEventListener('updateend', onUpdateEnd);
			buffer.removeEventListener('error', onError);
			buffer.removeEventListener('abort', onBufferAbort);
			signal.removeEventListener('abort', onSessionAbort);
		};
		const onUpdateEnd = () => {
			cleanupListeners();
			resolve();
		};
		const onError = (event: Event) => {
			cleanupListeners();
			reject(event);
		};
		const onBufferAbort = (event: Event) => {
			cleanupListeners();
			reject(event);
		};
		const onSessionAbort = () => {
			cleanupListeners();
			reject(createAbortError());
		};
		buffer.addEventListener('updateend', onUpdateEnd);
		buffer.addEventListener('error', onError);
		buffer.addEventListener('abort', onBufferAbort);
		signal.addEventListener('abort', onSessionAbort, { once: true });
		try {
			buffer.appendBuffer(data);
		} catch (error) {
			cleanupListeners();
			reject(error);
		}
	});
}

export function startDashStreams(
	videoEl: HTMLVideoElement,
	videoUrl: string,
	audioUrl?: string,
	headers?: Record<string, string>,
	metadata?: { videoCodec?: string; audioCodec?: string },
	dependencyOverrides: Partial<MSEPlayerDependencies> = {},
	proxyCapability?: HoverZoomProxyCapability,
): OwnedMSESession {
	const dependencies: MSEPlayerDependencies = {
		isSupported: isMSESupported,
		createMediaSource: () => new MediaSource(),
		createObjectUrl: (source) => URL.createObjectURL(source),
		revokeObjectUrl: (url) => URL.revokeObjectURL(url),
		fetchSegment: (url, requestHeaders) => {
			if (!proxyCapability) throw new Error('Proxy capability is required for DASH playback');
			return fetchArrayBufferWithProxy(url, requestHeaders, proxyCapability);
		},
		...dependencyOverrides,
	};
	if (!dependencies.isSupported()) throw new Error('MSE not supported');

	const session: MSESession = {
		mediaSource: dependencies.createMediaSource(),
		videoBuffer: null, audioBuffer: null,
		abortController: new AbortController(),
		aborted: false,
		videoOffset: 0, audioOffset: 0,
		videoEnded: false, audioEnded: !audioUrl
	};

	const objectUrl = dependencies.createObjectUrl(session.mediaSource);
	let objectUrlRevoked = false;
	try {
		videoEl.src = objectUrl;
	} catch (error) {
		dependencies.revokeObjectUrl(objectUrl);
		throw error;
	}

	const waitForSourceOpen = async (): Promise<void> => {
		rejectIfAborted(session.abortController.signal);
		if (session.mediaSource.readyState === 'open') return;

		let openTimeoutId: ReturnType<typeof setTimeout> | null = null;
		await new Promise<void>((resolve, reject) => {
			const cleanupListeners = () => {
				session.mediaSource.removeEventListener('sourceopen', onSourceOpen);
				session.mediaSource.removeEventListener('error', onError);
				session.abortController.signal.removeEventListener('abort', onAbort);
				if (openTimeoutId !== null) clearTimeout(openTimeoutId);
				openTimeoutId = null;
			};
			const onSourceOpen = () => {
				cleanupListeners();
				resolve();
			};
			const onError = (event: Event) => {
				cleanupListeners();
				reject(event);
			};
			const onAbort = () => {
				cleanupListeners();
				reject(createAbortError());
			};
			session.mediaSource.addEventListener('sourceopen', onSourceOpen);
			session.mediaSource.addEventListener('error', onError);
			session.abortController.signal.addEventListener('abort', onAbort, { once: true });
			openTimeoutId = setTimeout(() => {
				cleanupListeners();
				reject(new Error('MediaSource open timeout'));
			}, 5000);
		});
	};

	const initializeSourceBuffers = async (): Promise<void> => {
		await waitForSourceOpen();
		rejectIfAborted(session.abortController.signal);
		// Add source buffers
		const videoMime = metadata?.videoCodec ? `video/mp4; codecs="${metadata.videoCodec}"` : VIDEO_MIME;
		const audioMime = metadata?.audioCodec ? `audio/mp4; codecs="${metadata.audioCodec}"` : AUDIO_MIME;
		session.videoBuffer = session.mediaSource.addSourceBuffer(videoMime);
		if (audioUrl) session.audioBuffer = session.mediaSource.addSourceBuffer(audioMime);
	};

	// Load chunk helper - uses smaller size for initial load
	async function loadVideoChunk(isInitial = false): Promise<void> {
		if (session.aborted || session.videoEnded || !session.videoBuffer) return;
		const chunkSize = isInitial ? INITIAL_CHUNK : CHUNK_SIZE;
		const rangeHeaders = { ...headers, Range: `bytes=${session.videoOffset}-${session.videoOffset + chunkSize - 1}` };
		try {
			const data = await waitForAbortable(
				dependencies.fetchSegment(
					videoUrl,
					rangeHeaders,
					session.abortController.signal,
				),
				session.abortController.signal,
			);
			if (session.aborted) return;
			if (data.byteLength < chunkSize) session.videoEnded = true;
			session.videoOffset += data.byteLength;
			await appendBuffer(session.videoBuffer, data, session);
		} catch (error: unknown) {
			session.videoEnded = true;
			if (session.aborted) return;
			if (isInitial) throw error;
			console.warn(LOG_TAG, 'Video stream ended after a chunk failure', error);
		}
	}

	async function loadAudioChunk(isInitial = false): Promise<void> {
		if (session.aborted || session.audioEnded || !session.audioBuffer || !audioUrl) return;
		const chunkSize = isInitial ? INITIAL_CHUNK / 4 : CHUNK_SIZE / 4;
		const rangeHeaders = { ...headers, Range: `bytes=${session.audioOffset}-${session.audioOffset + chunkSize - 1}` };
		try {
			const data = await waitForAbortable(
				dependencies.fetchSegment(
					audioUrl,
					rangeHeaders,
					session.abortController.signal,
				),
				session.abortController.signal,
			);
			if (session.aborted) return;
			if (data.byteLength < chunkSize) session.audioEnded = true;
			session.audioOffset += data.byteLength;
			await appendBuffer(session.audioBuffer, data, session);
		} catch (error: unknown) {
			session.audioEnded = true;
			if (session.aborted) return;
			if (isInitial) throw error;
			console.warn(LOG_TAG, 'Audio stream ended after a chunk failure', error);
		}
	}

	// Greedy streaming: continuously load next chunks in background
	const streamLoop = async (): Promise<void> => {
		while (!session.aborted && (!session.videoEnded || !session.audioEnded)) {
			await Promise.all([loadVideoChunk(), loadAudioChunk()]);
			// Small delay to avoid hammering network if loads are fast
			await waitForDelay(100, session.abortController.signal);
		}
		// End stream when all loaded
		if (!session.aborted) {
			endMediaSource('stream completion');
		}
	};

	function endMediaSource(phase: string): void {
		if (session.mediaSource.readyState !== 'open') return;
		try {
			session.mediaSource.endOfStream();
		} catch (error: unknown) {
			console.debug(LOG_TAG, `MediaSource already closed during ${phase}`, error);
		}
	}

	function revokeObjectUrl(): void {
		if (objectUrlRevoked) return;
		objectUrlRevoked = true;
		dependencies.revokeObjectUrl(objectUrl);
	}

	function dispose(): void {
		if (session.aborted) return;
		session.aborted = true;
		session.abortController.abort();
		for (const buffer of [session.videoBuffer, session.audioBuffer]) {
			if (!buffer?.updating || session.mediaSource.readyState !== 'open') continue;
			try {
				buffer.abort();
			} catch (error: unknown) {
				console.debug(LOG_TAG, 'SourceBuffer already stopped during cleanup', error);
			}
		}
		endMediaSource('cleanup');
		revokeObjectUrl();
		if (videoEl.src === objectUrl) videoEl.src = '';
	}

	const ready = (async () => {
		await initializeSourceBuffers();
		// Initial load uses smaller chunks for fast first frame.
		await Promise.all([loadVideoChunk(true), loadAudioChunk(true)]);
		rejectIfAborted(session.abortController.signal);

		// The session owns this detached task and reports unexpected failures.
		void streamLoop().catch((error: unknown) => {
			if (session.aborted) return;
			console.error(LOG_TAG, 'Background stream failed', error);
			dispose();
		});
	})().catch((error: unknown) => {
		dispose();
		throw error;
	});

	return { ready, dispose };
}

export async function playDashStreams(
	videoEl: HTMLVideoElement,
	videoUrl: string,
	audioUrl?: string,
	headers?: Record<string, string>,
	metadata?: { videoCodec?: string; audioCodec?: string },
	dependencyOverrides: Partial<MSEPlayerDependencies> = {},
	proxyCapability?: HoverZoomProxyCapability,
): Promise<() => void> {
	const session = startDashStreams(
		videoEl,
		videoUrl,
		audioUrl,
		headers,
		metadata,
		dependencyOverrides,
		proxyCapability,
	);
	await session.ready;
	return session.dispose;
}

export function needsMSE(url: string): boolean {
	return url.includes('.m4s') || url.includes('bilivideo.com') || url.includes('bilivideo.cn');
}
