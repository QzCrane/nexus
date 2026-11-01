// goal: render a floating vertical scrollbar that mirrors the active scroll
// surface - the document root (`html`) for the main view, or `#view-settings`
// while the settings panel is the open, scrollable view - without consuming any
// layout width. The popup content therefore keeps equal left/right gutters on
// both pages, and the native width-taking scrollbar is hidden on every popup
// level scroller (see `popup.css`).
//
// inv:
//  - the main view scrolls `document.documentElement` (frame-height owns its
//    height/overflow); `#view-settings` is its own internal scroller. This module
//    reads the geometry of whichever is active and writes a visual overlay plus
//    pointer-driven scrollTop. It never changes the content box.
//  - the visible thumb is styled to match the native settings scrollbar (see
//    `.spectra-scrollbar__thumb` in popup.css) so the two views read as one.
//  - behaviour matches a native scrollbar: drag the thumb, click the track to
//    page (hold to keep paging), and drive it from the keyboard once focused.
//    Dragging pins the surface to instant scroll behaviour, because
//    `scroll-behavior: smooth` would animate every assignment and leave the
//    thumb trailing the pointer.

const MIN_THUMB_PX = 24;
const KEY_LINE_PX = 40;
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 250;

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

const overflowOf = (scroller: HTMLElement): number =>
	scroller.scrollHeight - scroller.clientHeight;

export function installOverlayScrollbar(): () => void {
	const bar = document.querySelector<HTMLElement>('.spectra-scrollbar');
	const thumb = bar?.querySelector<HTMLElement>('.spectra-scrollbar__thumb');
	if (!bar || !thumb) return () => undefined;
	const listeners = new AbortController();
	const { signal } = listeners;
	let disposed = false;
	let stopGesture: (() => void) | null = null;

	const settingsView = document.querySelector<HTMLElement>('#view-settings');

	// The surface that should drive the overlay right now: the settings panel
	// while it is the active, scrollable view, otherwise the document root.
	const getScroller = (): HTMLElement => {
		if (
			settingsView?.classList.contains('active')
			&& overflowOf(settingsView) > 1
		) {
			return settingsView;
		}
		return document.documentElement;
	};

	let dragging = false;

	const setDragging = (active: boolean): void => {
		if (dragging === active) return;
		dragging = active;
		bar.classList.toggle('is-dragging', active);
		document.documentElement.classList.toggle('spectra-scrollbar-dragging', active);
	};

	const update = (): void => {
		if (disposed) return;
		const scroller = getScroller();
		// `aria-controls` has to name the surface actually being scrolled: the
		// settings view while it is the active one, otherwise the document root.
		if (scroller.id) bar.setAttribute('aria-controls', scroller.id);
		const maxScroll = overflowOf(scroller);
		if (maxScroll <= 1) {
			bar.classList.add('is-hidden');
			bar.setAttribute('aria-valuenow', '0');
			bar.setAttribute('aria-valuemax', '0');
			thumb.style.height = '';
			thumb.style.transform = '';
			return;
		}
		bar.classList.remove('is-hidden');
		const track = scroller.clientHeight;
		const thumbH = clamp(track * (track / scroller.scrollHeight), MIN_THUMB_PX, track);
		const maxTravel = track - thumbH;
		const ratio = clamp(scroller.scrollTop / maxScroll, 0, 1);
		thumb.style.height = `${thumbH}px`;
		thumb.style.transform = `translateY(${ratio * maxTravel}px)`;
		bar.setAttribute('aria-valuenow', String(Math.round(scroller.scrollTop)));
		bar.setAttribute('aria-valuemax', String(Math.round(maxScroll)));
	};

	// Native scroll (wheel, trackpad, keyboard, programmatic) on either surface.
	window.addEventListener('scroll', update, { passive: true, signal });
	settingsView?.addEventListener('scroll', update, { passive: true, signal });

	// Content height changes: cards mount/unmount, the settings panel grows.
	const viewContainer = document.querySelector<HTMLElement>('.view-container');
	const resizeObserver = new ResizeObserver(update);
	if (viewContainer) resizeObserver.observe(viewContainer);
	resizeObserver.observe(document.documentElement);
	if (settingsView) resizeObserver.observe(settingsView);

	// Viewport / class changes: frame settles, side panel opens, settings toggles.
	const mo = new MutationObserver(update);
	mo.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-spectra-ready', 'class'],
	});
	if (settingsView) {
		mo.observe(settingsView, { attributes: true, attributeFilter: ['class'] });
	}

	// Keyboard: the bar is focusable, so it can be driven like a native one.
	bar.addEventListener('keydown', (event) => {
		const scroller = getScroller();
		if (overflowOf(scroller) <= 1) return;
		switch (event.key) {
			case 'ArrowUp':
				scroller.scrollBy({ top: -KEY_LINE_PX });
				break;
			case 'ArrowDown':
				scroller.scrollBy({ top: KEY_LINE_PX });
				break;
			case 'PageUp':
				scroller.scrollBy({ top: -scroller.clientHeight });
				break;
			case 'PageDown':
				scroller.scrollBy({ top: scroller.clientHeight });
				break;
			case 'Home':
				scroller.scrollTo({ top: 0 });
				break;
			case 'End':
				scroller.scrollTo({ top: overflowOf(scroller) });
				break;
			default:
				return;
		}
		event.preventDefault();
	}, { signal });

	// Drag the thumb: the pointer keeps the scroll position 1:1 with the track.
	const startDrag = (event: PointerEvent, scroller: HTMLElement): void => {
		stopGesture?.();
		const maxScroll = overflowOf(scroller);
		const thumbH = thumb.offsetHeight || MIN_THUMB_PX;
		const maxTravel = scroller.clientHeight - thumbH;
		const startY = event.clientY;
		const startTop = scroller.scrollTop;

		setDragging(true);
		const previousBehavior = scroller.style.scrollBehavior;
		scroller.style.scrollBehavior = 'auto';
		// Capture so a fast drag that leaves the 10px bar keeps steering it.
		bar.setPointerCapture(event.pointerId);

		const onMove = (moveEvent: PointerEvent): void => {
			const delta = moveEvent.clientY - startY;
			scroller.scrollTop = clamp(
				startTop + (maxTravel > 0 ? (delta / maxTravel) * maxScroll : 0),
				0,
				maxScroll,
			);
		};
		const onUp = (): void => {
			setDragging(false);
			scroller.style.scrollBehavior = previousBehavior;
			if (bar.hasPointerCapture(event.pointerId)) {
				bar.releasePointerCapture(event.pointerId);
			}
			bar.removeEventListener('pointermove', onMove);
			bar.removeEventListener('pointerup', onUp);
			bar.removeEventListener('pointercancel', onUp);
			if (stopGesture === onUp) stopGesture = null;
		};
		stopGesture = onUp;
		bar.addEventListener('pointermove', onMove);
		bar.addEventListener('pointerup', onUp);
		bar.addEventListener('pointercancel', onUp);
	};

	// Click the track to page, and hold to keep paging - the native behaviour.
	const startPaging = (event: PointerEvent, scroller: HTMLElement): void => {
		stopGesture?.();
		const barRect = bar.getBoundingClientRect();
		const thumbRect = thumb.getBoundingClientRect();
		const clickY = event.clientY - barRect.top;
		const direction = clickY < thumbRect.top - barRect.top ? -1 : 1;
		const page = (): void => {
			scroller.scrollBy({ top: direction * scroller.clientHeight });
		};
		page();

		let delay = 0;
		let interval = 0;
		const stop = (): void => {
			window.clearTimeout(delay);
			window.clearInterval(interval);
			bar.removeEventListener('pointerleave', stop);
			window.removeEventListener('pointerup', stop);
			window.removeEventListener('pointercancel', stop);
			if (stopGesture === stop) stopGesture = null;
		};
		stopGesture = stop;
		delay = window.setTimeout(() => {
			interval = window.setInterval(page, REPEAT_INTERVAL_MS);
		}, REPEAT_DELAY_MS);
		bar.addEventListener('pointerleave', stop);
		window.addEventListener('pointerup', stop, { once: true });
		window.addEventListener('pointercancel', stop, { once: true });
	};

	bar.addEventListener('pointerdown', (event) => {
		const scroller = getScroller();
		if (overflowOf(scroller) <= 1) return;
		event.preventDefault();
		// Focus so the keyboard handlers above can drive it straight after a click.
		bar.focus({ preventScroll: true });
		if (event.target === thumb) startDrag(event, scroller);
		else startPaging(event, scroller);
	}, { signal });

	update();
	return () => {
		if (disposed) return;
		disposed = true;
		listeners.abort();
		resizeObserver.disconnect();
		mo.disconnect();
		stopGesture?.();
		setDragging(false);
	};
}
