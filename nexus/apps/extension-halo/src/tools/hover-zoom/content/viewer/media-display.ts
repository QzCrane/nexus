import type { ViewerDOM } from '../viewer-dom';
import type { HoverZoomSettings } from '../../types';
import type { EnhancedResult } from '../resolvers/rule-resolver';
import { updateInfoBar } from './info';
import { isDashSegment, isPlayableVideoUrl, findThumbnailUrl } from './media-loader';
import { needsMSE, isMSESupported, startDashStreams } from './mse-player';
import type { OwnedMSESession } from './mse-session-owner';
import { MSESessionOwner } from './mse-session-owner';
import { applyLayout } from './display-layout';
import { showImage } from './image-display';

export { showImage };

const LOG_TAG = '[HALO:HoverZoom:MediaDisplay]';

const mseSessionOwner = new MSESessionOwner();

function requestPlayback(video: HTMLVideoElement, phase: string): void {
	void video.play().catch((error: unknown) => {
		console.debug(LOG_TAG, `${phase} autoplay was unavailable`, error);
	});
}

/** Cleanup previous MSE session */
export function cleanupMSE(): void {
	mseSessionOwner.retire();
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

	// Cleanup previous MSE session
	cleanupMSE();
	dom.video.onloadedmetadata = null;
	dom.video.onerror = null;

	// Check if this is a DASH stream needing MSE
	if (needsMSE(source.url) || source.audioUrl) {
		if (!isMSESupported()) {
			console.warn(LOG_TAG, 'MSE not supported, falling back to thumbnail');
			fallback(source, mouseX, mouseY);
			return;
		}

		dom.video.style.display = 'block';
		// Audio enabled - Chrome autoplay policy may require user interaction

		let playerSession: OwnedMSESession;
		try {
			playerSession = startDashStreams(
				dom.video,
				source.url,
				source.audioUrl,
				source.headers,
				source.metadata,
				undefined,
				source.proxyCapability,
			);
		} catch (error: unknown) {
			console.error(LOG_TAG, 'MSE playback could not start', error);
			fallback(source, mouseX, mouseY);
			return;
		}

		let metadataHandler: (() => void) | null = null;
		let interactionTimer: ReturnType<typeof setTimeout> | null = null;
		const viewerSession: OwnedMSESession = {
			ready: playerSession.ready,
			dispose: () => {
				if (
					metadataHandler
					&& dom.video.onloadedmetadata === metadataHandler
				) {
					dom.video.onloadedmetadata = null;
				}
				metadataHandler = null;
				if (interactionTimer !== null) {
					clearTimeout(interactionTimer);
					interactionTimer = null;
				}
				playerSession.dispose();
			},
		};

		mseSessionOwner.replace(viewerSession, {
			onReady: (isCurrent) => {
				metadataHandler = () => {
					if (dom.video.onloadedmetadata === metadataHandler) {
						dom.video.onloadedmetadata = null;
					}
					metadataHandler = null;
					if (!isCurrent() || !isVisible()) return;

					onLoaded();
					applyLayout(dom, triggerRect, currentType, mouseX, mouseY, dom.video.videoWidth, dom.video.videoHeight, settings.viewMode, settings.borderRadius);
					dom.viewer.classList.add('visible');

					// Delay interactivity to prevent underlying element from receiving mouseout during fade-in.
					interactionTimer = setTimeout(() => {
						interactionTimer = null;
						if (isCurrent() && isVisible()) {
							dom.viewer.classList.add('interactive');
						}
					}, 200);

					updateInfoBar(dom, settings, source, 'video', dom.video, dom.video.videoWidth, dom.video.videoHeight);
					requestPlayback(dom.video, 'MSE');
				};

				if (dom.video.readyState >= 1) {
					metadataHandler();
				} else {
					dom.video.onloadedmetadata = metadataHandler;
				}
			},
			onFailure: (error: unknown) => {
				console.error(LOG_TAG, 'MSE playback failed', error);
				fallback(source, mouseX, mouseY);
			},
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
		if (!isVisible()) return;

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

	requestPlayback(dom.video, 'Standard video');
}

export function fallbackToThumbnail(
	dom: ViewerDOM,
	settings: HoverZoomSettings,
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
		setCurrentType('image');
		showImage(dom, settings, { ...source, type: 'image', url: thumbUrl }, mouseX, mouseY, triggerRect, 'image', isVisible, onLoaded, onError);
	} else {
		console.warn(LOG_TAG, 'No thumbnail fallback available');
		onError();
	}
}
