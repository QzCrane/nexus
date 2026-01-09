// goal: MSE (MediaSource Extensions) player for DASH streams
// eff: Combines separate video + audio m4s streams into playable media

import { fetchArrayBufferWithProxy } from '../utils/proxy-utils';

const LOG_TAG = '[HALO:HoverZoom:MSEPlayer]';

// MIME types for common DASH formats
const VIDEO_MIME = 'video/mp4; codecs="avc1.640028"';
const AUDIO_MIME = 'audio/mp4; codecs="mp4a.40.2"';

interface MSESession {
	mediaSource: MediaSource;
	videoBuffer: SourceBuffer | null;
	audioBuffer: SourceBuffer | null;
	aborted: boolean;
}

/**
 * Check if MSE is supported for DASH playback
 */
export function isMSESupported(): boolean {
	return 'MediaSource' in window && MediaSource.isTypeSupported(VIDEO_MIME);
}

/**
 * Fetch media segment through background proxy to bypass CORS
 */
async function fetchSegment(url: string, headers?: Record<string, string>): Promise<ArrayBuffer> {
	return fetchArrayBufferWithProxy(url, headers);
}

/**
 * Append buffer with safety checks for aborted sessions
 */
function appendBuffer(buffer: SourceBuffer, data: ArrayBuffer, session: MSESession): Promise<void> {
	return new Promise((resolve, reject) => {
		// Safety: check if session was aborted or buffer removed
		if (session.aborted || session.mediaSource.readyState !== 'open') {
			resolve(); // Silently skip if aborted
			return;
		}
		if (buffer.updating) {
			buffer.addEventListener('updateend', () => appendBuffer(buffer, data, session).then(resolve).catch(reject), { once: true });
			return;
		}
		try {
			buffer.appendBuffer(data);
			buffer.addEventListener('updateend', () => resolve(), { once: true });
			buffer.addEventListener('error', (e) => reject(e), { once: true });
		} catch (e) {
			reject(e);
		}
	});
}

/**
 * Play DASH video + audio streams using MSE
 * @param videoEl - Target video element
 * @param videoUrl - Video stream URL (m4s)
 * @param audioUrl - Audio stream URL (m4s), optional
 * @param headers - Request headers (e.g., Referer)
 * @returns Cleanup function to abort loading
 */
export async function playDashStreams(
	videoEl: HTMLVideoElement,
	videoUrl: string,
	audioUrl?: string,
	headers?: Record<string, string>,
	metadata?: { videoCodec?: string; audioCodec?: string }
): Promise<() => void> {
	if (!isMSESupported()) {
		throw new Error('MSE not supported');
	}

	console.log(LOG_TAG, 'Starting MSE playback', { videoUrl: videoUrl.slice(0, 80), hasAudio: !!audioUrl, metadata });

	const session: MSESession = {
		mediaSource: new MediaSource(),
		videoBuffer: null,
		audioBuffer: null,
		aborted: false
	};

	const objectUrl = URL.createObjectURL(session.mediaSource);
	videoEl.src = objectUrl;

	// Wait for MediaSource to open
	await new Promise<void>((resolve, reject) => {
		session.mediaSource.addEventListener('sourceopen', () => resolve(), { once: true });
		session.mediaSource.addEventListener('error', (e) => reject(e), { once: true });
		// Timeout after 5s
		setTimeout(() => reject(new Error('MediaSource open timeout')), 5000);
	});

	if (session.aborted) {
		cleanup();
		return () => { };
	}

	// Add source buffers
	try {
		// Calculate MIME types with codecs
		const videoMime = metadata?.videoCodec
			? `video/mp4; codecs="${metadata.videoCodec}"`
			: VIDEO_MIME;

		const audioMime = metadata?.audioCodec
			? `audio/mp4; codecs="${metadata.audioCodec}"`
			: AUDIO_MIME;

		console.log(LOG_TAG, 'Using MIMEs:', { videoMime, audioMime });

		session.videoBuffer = session.mediaSource.addSourceBuffer(videoMime);
		if (audioUrl) {
			session.audioBuffer = session.mediaSource.addSourceBuffer(audioMime);
		}
	} catch (e) {
		console.error(LOG_TAG, 'Failed to add source buffer', e);
		cleanup();
		throw e;
	}

	// Fetch and append streams in parallel (reduced size for faster preview)
	const loadPromises: Promise<void>[] = [];

	// Load video (First 4MB for quick preview)
	const videoHeaders = { ...headers, Range: 'bytes=0-4194304' };
	loadPromises.push(
		fetchSegment(videoUrl, videoHeaders).then(async (data) => {
			if (session.aborted || !session.videoBuffer) return;
			await appendBuffer(session.videoBuffer, data, session);
			console.log(LOG_TAG, 'Video segment loaded', data.byteLength);
		})
	);

	// Load audio if present (First 1MB for preview)
	if (audioUrl && session.audioBuffer) {
		const audioHeaders = { ...headers, Range: 'bytes=0-1048576' };
		loadPromises.push(
			fetchSegment(audioUrl, audioHeaders).then(async (data) => {
				if (session.aborted || !session.audioBuffer) return;
				await appendBuffer(session.audioBuffer, data, session);
				console.log(LOG_TAG, 'Audio segment loaded', data.byteLength);
			})
		);
	}

	// Wait for both to complete
	try {
		await Promise.all(loadPromises);
	} catch (e) {
		console.error(LOG_TAG, 'Stream loading failed', e);
		cleanup();
		throw e;
	}

	// End stream when all data is loaded
	if (!session.aborted && session.mediaSource.readyState === 'open') {
		const waitForUpdate = async () => {
			const buffers = [session.videoBuffer, session.audioBuffer].filter(Boolean) as SourceBuffer[];
			while (buffers.some(b => b.updating)) {
				await new Promise(r => setTimeout(r, 50));
			}
		};
		await waitForUpdate();
		try {
			session.mediaSource.endOfStream();
		} catch (e) {
			// Ignore if already ended
		}
	}

	console.log(LOG_TAG, 'MSE playback ready');

	// Cleanup function
	function cleanup() {
		session.aborted = true;
		if (session.mediaSource.readyState === 'open') {
			try {
				session.mediaSource.endOfStream();
			} catch { }
		}
		URL.revokeObjectURL(objectUrl);
	}

	return cleanup;
}

/**
 * Check if URL is a DASH segment (m4s) that needs MSE
 */
export function needsMSE(url: string): boolean {
	return url.includes('.m4s') || url.includes('bilivideo.com') || url.includes('bilivideo.cn');
}
