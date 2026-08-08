// goal: top-frame Smooth Scroll host at document_start
// inv: Smooth Scroll owns only the top document's physical scroll input; child frames remain native.

import { init } from '../content/smooth-scroll';

void init().catch((error: unknown) => {
	console.error('[HALO:SmoothScroll]', 'Initialization failed', error);
});
