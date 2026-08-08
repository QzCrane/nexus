// goal: all-frame Smooth Scroll host at document_start
// inv: Smooth Scroll owns page/frame-local physical input and must initialize in every matching frame.

import { init } from '../content/smooth-scroll';

void init().catch((error: unknown) => {
	console.error('[HALO:SmoothScroll]', 'Initialization failed', error);
});
