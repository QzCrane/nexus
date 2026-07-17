// goal: MSE (MediaSource Extensions) player with streaming support
// eff: Combines video+audio m4s streams, supports incremental loading

import { fetchArrayBufferWithProxy } from '../utils/proxy-utils';

const LOG_TAG = '[HALO:HoverZoom:MSEPlayer]';
const VIDEO_MIME = 'video/mp4; codecs="avc1.640028"';
const AUDIO_MIME = 'audio/mp4; codecs="mp4a.40.2"';
const INITIAL_CHUNK = 768 * 1024;    // 768KB for fast first frame
const CHUNK_SIZE = 2 * 1024 * 1024;  // 2MB for subsequent chunks
const BUFFER_THRESHOLD = 3;          // Load more when < 3s buffered

interface MSESession {
	mediaSource: MediaSource;
	videoBuffer: SourceBuffer | null;
	audioBuffer: SourceBuffer | null;
	aborted: boolean;
	videoOffset: number;
	audioOffset: number;
	videoEnded: boolean;
	audioEnded: boolean;
}

export function isMSESupported(): boolean {
	return 'MediaSource' in window && MediaSource.isTypeSupported(VIDEO_MIME);
}

async function fetchSegment(url: string, headers?: Record<string, string>): Promise<ArrayBuffer> {
	return fetchArrayBufferWithProxy(url, headers);
}

async function appendBuffer(buffer: SourceBuffer, data: ArrayBuffer, session: MSESession): Promise<void> {
	return new Promise((resolve, reject) => {
		if (session.aborted || session.mediaSource.readyState !== 'open') { resolve(); return; }
		if (buffer.updating) {
			buffer.addEventListener('updateend', () => appendBuffer(buffer, data, session).then(resolve).catch(reject), { once: true });
			return;
		}
		try {
			buffer.appendBuffer(data);
			buffer.addEventListener('updateend', () => resolve(), { once: true });
			buffer.addEventListener('error', (e) => reject(e), { once: true });
		} catch (e) { reject(e); }
	});
}

// Get buffered time ahead of playhead
function getBufferedAhead(video: HTMLVideoElement): number {
	const buf = video.buffered;
	if (!buf.length) return 0;
	for (let i = 0; i < buf.length; i++) {
		if (video.currentTime >= buf.start(i) && video.currentTime <= buf.end(i)) {
			return buf.end(i) - video.currentTime;
		}
	}
	return 0;
}

export async function playDashStreams(
	videoEl: HTMLVideoElement,
	videoUrl: string,
	audioUrl?: string,
	headers?: Record<string, string>,
	metadata?: { videoCodec?: string; audioCodec?: string }
): Promise<() => void> {
	if (!isMSESupported()) throw new Error('MSE not supported');

	console.log(LOG_TAG, 'Starting MSE playback', { videoUrl: videoUrl.slice(0, 80), hasAudio: !!audioUrl });

	const session: MSESession = {
		mediaSource: new MediaSource(),
		videoBuffer: null, audioBuffer: null,
		aborted: false,
		videoOffset: 0, audioOffset: 0,
		videoEnded: false, audioEnded: false
	};

	const objectUrl = URL.createObjectURL(session.mediaSource);
	videoEl.src = objectUrl;

	let openTimeoutId: ReturnType<typeof setTimeout> | null = null;
	await new Promise<void>((resolve, reject) => {
		session.mediaSource.addEventListener('sourceopen', () => {
			if (openTimeoutId) { clearTimeout(openTimeoutId); openTimeoutId = null; }
			resolve();
		}, { once: true });
		session.mediaSource.addEventListener('error', (e) => {
			if (openTimeoutId) { clearTimeout(openTimeoutId); openTimeoutId = null; }
			URL.revokeObjectURL(objectUrl);
			reject(e);
		}, { once: true });
		openTimeoutId = setTimeout(() => {
			openTimeoutId = null;
			URL.revokeObjectURL(objectUrl);
			reject(new Error('MediaSource open timeout'));
		}, 5000);
	});

	if (session.aborted) { cleanup(); return () => { }; }

	// Add source buffers
	const videoMime = metadata?.videoCodec ? `video/mp4; codecs="${metadata.videoCodec}"` : VIDEO_MIME;
	const audioMime = metadata?.audioCodec ? `audio/mp4; codecs="${metadata.audioCodec}"` : AUDIO_MIME;
	session.videoBuffer = session.mediaSource.addSourceBuffer(videoMime);
	if (audioUrl) session.audioBuffer = session.mediaSource.addSourceBuffer(audioMime);

	// Load chunk helper - uses smaller size for initial load
	async function loadVideoChunk(isInitial = false) {
		if (session.aborted || session.videoEnded || !session.videoBuffer) return;
		const chunkSize = isInitial ? INITIAL_CHUNK : CHUNK_SIZE;
		const rangeHeaders = { ...headers, Range: `bytes=${session.videoOffset}-${session.videoOffset + chunkSize - 1}` };
		try {
			const data = await fetchSegment(videoUrl, rangeHeaders);
			if (session.aborted) return;
			if (data.byteLength < chunkSize) session.videoEnded = true;
			session.videoOffset += data.byteLength;
			await appendBuffer(session.videoBuffer, data, session);
			console.log(LOG_TAG, 'Video chunk loaded', session.videoOffset);
		} catch (e) { session.videoEnded = true; }
	}

	async function loadAudioChunk(isInitial = false) {
		if (session.aborted || session.audioEnded || !session.audioBuffer || !audioUrl) return;
		const chunkSize = isInitial ? INITIAL_CHUNK / 4 : CHUNK_SIZE / 4;
		const rangeHeaders = { ...headers, Range: `bytes=${session.audioOffset}-${session.audioOffset + chunkSize - 1}` };
		try {
			const data = await fetchSegment(audioUrl, rangeHeaders);
			if (session.aborted) return;
			if (data.byteLength < chunkSize) session.audioEnded = true;
			session.audioOffset += data.byteLength;
			await appendBuffer(session.audioBuffer, data, session);
			console.log(LOG_TAG, 'Audio chunk loaded', session.audioOffset);
		} catch (e) { session.audioEnded = true; }
	}

	// Initial load with smaller chunks for fast first frame
	await Promise.all([loadVideoChunk(true), loadAudioChunk(true)]);
	console.log(LOG_TAG, 'Initial load complete, starting background streaming');

	// Greedy streaming: continuously load next chunks in background
	const streamLoop = async () => {
		while (!session.aborted && (!session.videoEnded || !session.audioEnded)) {
			await Promise.all([loadVideoChunk(), loadAudioChunk()]);
			// Small delay to avoid hammering network if loads are fast
			await new Promise(r => setTimeout(r, 100));
		}
		// End stream when all loaded
		if (!session.aborted && session.mediaSource.readyState === 'open') {
			try { session.mediaSource.endOfStream(); } catch { }
			console.log(LOG_TAG, 'Stream complete');
		}
	};
	// Start streaming in background (don't await)
	streamLoop();

	function cleanup() {
		session.aborted = true;
		if (session.mediaSource.readyState === 'open') {
			try { session.mediaSource.endOfStream(); } catch { }
		}
		URL.revokeObjectURL(objectUrl);
	}

	return cleanup;
}

export function needsMSE(url: string): boolean {
	return url.includes('.m4s') || url.includes('bilivideo.com') || url.includes('bilivideo.cn');
}
