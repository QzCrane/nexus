/**
 * SPECTRA Popup - Card 模块导出
 */

// 主函数
export { initCard } from './init';

// 类型
export {
  DEFAULT_CONFIG,
  cleanConfig,
  type CardInternalState,
  type CardContext,
  type InitCardParams
} from './types';

// 子模块
export { getCardUIElements } from './ui-elements';
export { createGetCapturing, createUpdateFn } from './state';
export { createRenderFn, type RenderParams } from './render';
export { bindCardEvents, type EventsParams } from './events';
export { setupCardMessaging, connectToTab, type MessagingParams } from './messaging';
