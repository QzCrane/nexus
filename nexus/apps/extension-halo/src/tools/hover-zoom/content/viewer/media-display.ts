import { ViewerDOM } from '../viewer-dom';
import { HoverZoomSettings } from '../../types';
import type { EnhancedResult } from '../resolvers/rule-resolver';
import { updateInfoBar } from './info';
import { isDashSegment, isPlayableVideoUrl, findThumbnailUrl } from './media-loader';
import { needsMSE, isMSESupported, playDashStreams } from './mse-player';
import { applyLayout } from './display-layout';
import { showImage } from './image-display';

export { showImage };

const LOG_TAG = '[HALO:HoverZoom:MediaDisplay]';

// Track MSE cleanup function
let mseCleanup: (() => void) | null = null;

/** Cleanup previous MSE session */
export function cleanupMSE() {
	if (mseCleanup) {
		mseCleanup();
		mseCleanup = null;
	}
}

export function showVideo(
	dom: ViewerDOM,
	settings: HoverZoomSettings,
	source: EnhancedResult,
	mouseX: number,
	mouseY: number,
	triggerRect: DOMRect | null,
	currentType: string,
	isVisible: () => boolean,
	onLoaded: () => void,
	onError: () => void,
	fallback: (source: EnhancedResult, mouseX: number, mouseY: number) => void
): void {
	if (!dom) return;

	console.log(LOG_TAG, 'Loading video:', source.url.slice(0, 100), 'audioUrl:', source.audioUrl?.slice(0, 50));

	// Cleanup previous MSE session
	cleanupMSE();

	// Check if this is a DASH stream needing MSE
	if (needsMSE(source.url) || source.audioUrl) {
		if (!isMSESupported()) {
			console.warn(LOG_TAG, 'MSE not supported, falling back to thumbnail');
			fallback(source, mouseX, mouseY);
			return;
		}

		// Use MSE player for DASH streams
		console.log(LOG_TAG, 'Using MSE for DASH playback');
		dom.video.style.display = 'block';
		// Audio enabled - Chrome autoplay policy may require user interaction

		playDashStreams(
			dom.video,
			source.url,
			source.audioUrl,
			source.headers,
			source.metadata as { videoCodec?: string; audioCodec?: string } | undefined
		).then(cleanup => {
			mseCleanup = cleanup;

			// Wait for metadata
			const onMeta = () => {
				console.log(LOG_TAG, 'MSE video loaded', dom?.video.videoWidth, dom?.video.videoHeight);
				if (!isVisible() || !dom) return;

				onLoaded();
				applyLayout(dom, triggerRect, currentType, mouseX, mouseY, dom.video.videoWidth, dom.video.videoHeight, settings.viewMode, settings.borderRadius);
				dom.viewer.classList.add('visible');

				// Delay interactivity to prevent underlying element from receiving mouseout during fade-in
				setTimeout(() => {
					if (isVisible() && dom) dom.viewer.classList.add('interactive');
				}, 200);

				updateInfoBar(dom, settings, source, 'video', dom.video, dom.video.videoWidth, dom.video.videoHeight);
				dom.video.play().catch(() => { });
			};

			if (dom.video.readyState >= 1) {
				onMeta();
			} else {
				dom.video.onloadedmetadata = onMeta;
			}
		}).catch(e => {
			console.error(LOG_TAG, 'MSE playback failed:', e);
			fallback(source, mouseX, mouseY);
		});

		return;
	}

	// Check if URL is DASH segment without audioUrl (incomplete DASH, fallback)
	if (isDashSegment(source.url)) {
		console.warn(LOG_TAG, 'DASH m4s stream without audio, falling back to thumbnail');
		fallback(source, mouseX, mouseY);
		return;
	}

	// Check if URL looks like a playable video format
	if (!isPlayableVideoUrl(source.url)) {
		console.warn(LOG_TAG, 'Unrecognized video URL format, falling back to thumbnail');
		fallback(source, mouseX, mouseY);
		return;
	}

	// Standard video playback
	dom.video.style.display = 'block';
	dom.video.src = source.url;
	// Audio enabled - Chrome autoplay policy may require user interaction

	dom.video.onloadedmetadata = () => {
		console.log(LOG_TAG, 'Video loaded', dom?.video.videoWidth, dom?.video.videoHeight);
		if (!isVisible() || !dom) return;

		onLoaded();
		applyLayout(dom, triggerRect, currentType, mouseX, mouseY, dom.video.videoWidth, dom.video.videoHeight, settings.viewMode, settings.borderRadius);
		dom.viewer.classList.add('visible');

		// Delay interactivity to prevent underlying element from receiving mouseout during fade-in
		setTimeout(() => {
			if (isVisible() && dom) dom.viewer.classList.add('interactive');
		}, 200);

		updateInfoBar(dom, settings, source, 'video', dom.video, dom.video.videoWidth, dom.video.videoHeight);
	};

	dom.video.onerror = (e) => {
		console.error(LOG_TAG, 'Video load error:', source.url.slice(0, 100), e);
		onError();
		fallback(source, mouseX, mouseY);
	};

	dom.video.play().catch(() => { });
}

export function fallbackToThumbnail(
	dom: ViewerDOM,
	source: EnhancedResult,
	mouseX: number,
	mouseY: number,
	triggerRect: DOMRect | null,
	isVisible: () => boolean,
	onLoaded: () => void,
	onError: () => void,
	setCurrentType: (type: 'image' | 'video') => void
): void {
	cleanupMSE();

	if (dom) {
		dom.video.style.display = 'none';
		dom.video.src = '';
	}

	const thumbUrl = findThumbnailUrl(source.element);
	if (thumbUrl) {
		console.log(LOG_TAG, 'Using thumbnail fallback:', thumbUrl.slice(0, 80));
		setCurrentType('image');
		showImage(dom, {} as any, { ...source, type: 'image', url: thumbUrl }, mouseX, mouseY, triggerRect, 'image', isVisible, onLoaded, onError);
	} else {
		console.warn(LOG_TAG, 'No thumbnail fallback available');
		onError();
	}
}
