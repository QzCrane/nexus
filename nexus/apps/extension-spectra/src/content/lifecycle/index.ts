/**
 * Content Script - 生命周期模块索引
 * 
 * 导出所有生命周期相关功能
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

