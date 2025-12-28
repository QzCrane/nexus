/**
 * SPECTRA - Extension Logging Module
 * 
 * Extends @nexus/kernel logger with [SPECTRA] prefix and capture/mode logic.
 */

import { createLogger as kernelCreateLogger, createPlainLogger, LOG_COLORS } from '@nexus/kernel';

export { createPlainLogger, LOG_COLORS } from '@nexus/kernel';

export function createLogger(tag: string) {
	const base = kernelCreateLogger(tag);
	const fullPrefix = `[SPECTRA] [${tag}]`;

	return {
		...base,
		capture(...args: unknown[]) {
			console.log(`%c${fullPrefix} [CAPTURE]`, LOG_COLORS.capture, ...args);
		},
		mode(from: string | null, to: string) {
			console.log(`%c${fullPrefix} Mode: ${from || 'null'} -> ${to}`, LOG_COLORS.info);
		},
	};
}

export const logger = {
	content: createLogger('Content'),
	background: createLogger('Background'),
	popup: createLogger('Popup'),
	offscreen: createLogger('Offscreen'),
};

export const swLog = createPlainLogger('Background');

