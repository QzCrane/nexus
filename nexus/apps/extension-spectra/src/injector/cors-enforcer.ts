// goal: apply CORS defaults only while SPECTRA explicitly uses its WebAudio path

export function enforceCORS(): () => void {
	const originalCreateElement = document.createElement;
	const originalCreateElementNS = document.createElementNS;
	const OriginalAudio = window.Audio;
	let installed = false;

	const enforceCrossOrigin = (element: Element, tagName: string) => {
		const normalized = tagName.toLowerCase();
		if (normalized === 'video' || normalized === 'audio') element.setAttribute('crossorigin', 'anonymous');
	};

	const createElement = function (this: Document, tagName: string, options?: ElementCreationOptions) {
		const element = originalCreateElement.call(this, tagName, options);
		enforceCrossOrigin(element, tagName);
		return element;
	};
	const createElementNS = function (
		this: Document,
		namespace: string | null,
		qualifiedName: string,
		options?: ElementCreationOptions,
	) {
		const element = originalCreateElementNS.call(this, namespace, qualifiedName, options);
		enforceCrossOrigin(element, qualifiedName);
		return element;
	};
	const SpectraAudio = ((src?: string) => {
		const element = new OriginalAudio(src);
		element.crossOrigin = 'anonymous';
		return element;
	}) as unknown as typeof Audio;
	SpectraAudio.prototype = OriginalAudio.prototype;

	const install = () => {
		if (installed) return;
		installed = true;
		document.createElement = createElement as typeof document.createElement;
		document.createElementNS = createElementNS as typeof document.createElementNS;
		window.Audio = SpectraAudio;
	};
	const uninstall = () => {
		if (!installed) return;
		installed = false;
		if (document.createElement === createElement) document.createElement = originalCreateElement;
		if (document.createElementNS === createElementNS) document.createElementNS = originalCreateElementNS;
		if (window.Audio === SpectraAudio) window.Audio = OriginalAudio;
	};
	const listener = (event: MessageEvent) => {
		if (event.source !== window || event.data?.type !== 'SPECTRA_WEBAUDIO_STATE') return;
		if (event.data.active === true) install();
		else uninstall();
	};
	window.addEventListener('message', listener);
	return () => {
		window.removeEventListener('message', listener);
		uninstall();
	};
}
