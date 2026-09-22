// goal: aggregation layer for the card component, orchestrating state, rendering, and cross-process messaging for individual tab controls

export { initCard } from './init';
export { readCardSnapshot, CARD_SNAPSHOT_CONCURRENCY } from './snapshot';

export {
  cleanConfig,
  type CardInternalState,
  type CardContext,
  type CardSnapshot,
  type InitCardParams
} from './types';

export { getCardUIElements } from './ui-elements';
export { createGetCapturing, createUpdateFn } from './state';
export { createRenderFn, type RenderParams } from './render';
export { bindCardEvents, type EventsParams } from './events';
export { setupCardMessaging, type MessagingParams } from './messaging';
