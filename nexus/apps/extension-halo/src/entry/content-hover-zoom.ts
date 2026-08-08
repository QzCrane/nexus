// goal: top-frame Hover Zoom host, deferred outside the document_start critical path

import { init } from '../content/hover-zoom';

void init().catch((error: unknown) => {
	console.warn('[HALO:HoverZoom]', 'Initialization failed', error);
});
