/**
 * // goal: Export lifecycle functionality (MediaObserver, Intervals, UserInteraction, Fullscreen, Navigation)
 */

export { createMediaObserver, hasMediaElements } from './media-observer';
export {
	createStateReapplyInterval,
	createMediaReportInterval,
	reportMediaState,
	cleanupIntervals
} from './intervals';
export {
	setupUserGestureListeners,
	setupPopupConnectionListener
} from './user-interaction';
export { setupFullscreenHandler } from './fullscreen-handler';
export { createNavigationObserver } from './navigation-observer';

