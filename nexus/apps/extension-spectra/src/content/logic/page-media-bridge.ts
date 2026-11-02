// goal: synchronously cross the exact-element ISOLATED/MAIN boundary for page-owned media semantics

import { isFiniteControlValue, type ControlValues } from '@nexus/contracts';
import {
	SPECTRA_PAGE_MEDIA_EVENT,
	SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE,
	SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE,
	type SpectraPageMediaField,
	type SpectraPageMediaRequest,
	type SpectraPageMediaResult,
} from '../../shared/page-media-bridge';
import { resolveDeclaredSiteAdapter, SITE_ADAPTER_LIMITS, siteSpeedFromText } from '../../shared/site-adapter-registry';

/** null leaves generic continuous controllers unchanged. A declared menu only
 * admits a value it offers for this exact, unambiguous player. Our projected
 * toolbar label is deliberately excluded from this capability evidence.
 */
export function declaredPageSpeedAdmission(element: HTMLMediaElement, speed: number): boolean | null {
	const spec = resolveDeclaredSiteAdapter('speed')?.projection;
	if (!spec?.optionSelector) return null;
	const rootSelector = spec.rootSelector;
	if (!rootSelector) return false;
	const root = element.closest(rootSelector);
	if (!root) return false;
	const media = [...root.querySelectorAll('video, audio')]
		.filter((candidate) => candidate.closest(rootSelector) === root);
	if (media.length !== 1 || media[0] !== element) return false;
	const options = root.querySelectorAll(spec.optionSelector);
	for (let index = 0; index < Math.min(options.length, SITE_ADAPTER_LIMITS.maxProjectionTextNodes); index += 1) {
		const option = options[index];
		if (!option || option.closest(rootSelector) !== root
			|| option.hasAttribute('disabled') || option.getAttribute('aria-disabled') === 'true') continue;
		const value = siteSpeedFromText(option.textContent ?? '', spec);
		if (value !== null && Math.abs(value - speed) <= 0.005) return true;
	}
	return false;
}

/** Bootstrap owns the lifetime, even while the full runtime is resident.
 * This is presentation only: never writes a rate or supplies controller ACKs.
 */
export function createSiteSpeedLabelProjection(): {
	syncMedia(element: HTMLMediaElement): void;
	scan(): void;
	dispose(): void;
} {
	const spec = resolveDeclaredSiteAdapter('speed')?.projection;
	const rootSelector = spec?.rootSelector;
	const labelSelector = spec?.labelSelector;
	const observers = new Map<Element, MutationObserver>();
	const originals = new WeakMap<Text, { original: string; written: string }>();
	let disposed = false;
	const restoreRoot = (root: Element): void => {
		if (!labelSelector) return;
		for (const label of root.querySelectorAll(labelSelector)) {
			const node = label.firstChild;
			if (!(node instanceof Text)) continue;
			const original = originals.get(node);
			if (original && node.data === original.written) node.data = original.original;
		}
	};

	const prune = (): void => {
		for (const [root, observer] of observers) {
			if (root.isConnected) continue;
			observer.disconnect();
			observers.delete(root);
		}
	};
	const syncRoot = (root: Element): void => {
		if (disposed || !rootSelector || !labelSelector) return;
		prune();
		if (!root.isConnected) return;
		const media = Array.from(root.querySelectorAll('video, audio'))
			.filter((element): element is HTMLMediaElement => (
				element instanceof HTMLMediaElement && element.closest(rootSelector) === root
			));
		// Ambiguous containers cannot borrow another player's rate.
		if (media.length !== 1) {
			restoreRoot(root);
			return;
		}
		const rate = media[0]?.playbackRate;
		if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return;
		const text = `${rate}x`;
		for (const label of root.querySelectorAll(labelSelector)) {
			if (label.closest(rootSelector) !== root) continue;
			// Preserve React's text-node identity and every other child/control.
			// A changed site shape must not turn this into a destructive rewrite.
			const node = label.firstChild;
			if (!(node instanceof Text) || label.childNodes.length !== 1 || node.data === text) continue;
			const previous = originals.get(node);
			originals.set(node, {
				original: previous && node.data === previous.written ? previous.original : node.data,
				written: text,
			});
			node.data = text;
		}
	};
	const syncMedia = (element: HTMLMediaElement): void => {
		if (disposed || !rootSelector || !labelSelector) return;
		prune();
		const root = element.closest(rootSelector);
		if (!root?.isConnected) return;
		if (!observers.has(root)) {
			const observer = new MutationObserver((mutations) => {
				// Observe only known player roots, never the entire document. Most
				// mutations (timestamps/comments) cannot invalidate the speed label.
				const relevant = mutations.some((mutation) => {
					const target = mutation.target instanceof Element
						? mutation.target : mutation.target.parentElement;
					if (target?.matches(labelSelector)) return true;
					return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element
						&& (node.matches(`${labelSelector}, video, audio`)
							|| node.querySelector(`${labelSelector}, video, audio`) !== null));
				});
				prune();
				if (relevant) syncRoot(root);
			});
			observer.observe(root, { childList: true, characterData: true, subtree: true });
			observers.set(root, observer);
		}
		syncRoot(root);
	};
	return {
		syncMedia,
		scan() {
			if (disposed || !labelSelector) return;
			for (const element of document.querySelectorAll('video, audio')) {
				if (element instanceof HTMLMediaElement) syncMedia(element);
			}
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const [root, observer] of observers) {
				observer.disconnect();
				restoreRoot(root);
			}
			observers.clear();
		},
	};
}

function isActualValue<K extends SpectraPageMediaField>(
	field: K,
	value: unknown,
): value is ControlValues[K] {
	if (field === 'mediaMuted') return typeof value === 'boolean';
	return field === 'volumeBase'
		? isFiniteControlValue(value, 'nativeVolume')
		: isFiniteControlValue(value, 'speed');
}

function decodeResult<K extends SpectraPageMediaField>(
	encoded: string | null,
	requestId: string,
	field: K,
): SpectraPageMediaResult | null {
	if (!encoded) return null;
	try {
		const result = JSON.parse(encoded) as Partial<SpectraPageMediaResult>;
		return result.requestId === requestId
			&& result.field === field
			&& typeof result.supported === 'boolean'
			&& (result.actual === null || isActualValue(field, result.actual))
			&& (result.error === undefined || typeof result.error === 'string')
			&& (result.adapterId === undefined || typeof result.adapterId === 'string')
			&& (result.projection === undefined
				|| result.projection === null
				|| isActualValue(field, result.projection))
			? result as SpectraPageMediaResult
			: null;
	} catch {
		return null;
	}
}

function dispatch<K extends SpectraPageMediaField>(
	element: HTMLMediaElement,
	request: SpectraPageMediaRequest & { field: K },
	result?: { value: SpectraPageMediaResult | null },
): ControlValues[K] | null {
	if (typeof document === 'undefined'
		|| typeof element.setAttribute !== 'function'
		|| typeof element.dispatchEvent !== 'function') return null;
	try {
		element.setAttribute(SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE, JSON.stringify(request));
		element.dispatchEvent(new Event(SPECTRA_PAGE_MEDIA_EVENT, { composed: true }));
		const decoded = decodeResult(
			element.getAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE),
			request.requestId,
			request.field,
		);
		if (result) result.value = decoded;
		if (!decoded?.supported) return null;
		if (request.operation === 'probe') return true as ControlValues[K];
		if (decoded.error || decoded.actual === null) {
			throw new Error(decoded.error ?? `Page-media ${request.field} returned no actual value`);
		}
		return decoded.actual as ControlValues[K];
	} finally {
		element.removeAttribute(SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE);
		element.removeAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE);
	}
}

export function readPageMediaField<K extends SpectraPageMediaField>(
	element: HTMLMediaElement,
	field: K,
): ControlValues[K] | null {
	return dispatch(element, {
		requestId: crypto.randomUUID(),
		operation: 'read',
		field,
	});
}

/** Everything the bridge knows about a read, including its evidence channels. */
export interface PageMediaEvidence<K extends SpectraPageMediaField> {
	readonly actual: ControlValues[K];
	/**
	 * What the player's own UI showed. `null` means unreadable — never that the
	 * UI agreed. Only a declared adapter can produce one.
	 */
	readonly projection: ControlValues[K] | null;
	/** Set when a declared site adapter answered; null for generic discovery. */
	readonly adapterId: string | null;
}

export function readPageMediaEvidence<K extends SpectraPageMediaField>(
	element: HTMLMediaElement,
	field: K,
): PageMediaEvidence<K> | null {
	const holder: { value: SpectraPageMediaResult | null } = { value: null };
	const actual = dispatch(element, {
		requestId: crypto.randomUUID(),
		operation: 'read',
		field,
	}, holder);
	if (actual === null || !holder.value) return null;
	return {
		actual,
		projection: (holder.value.projection ?? null) as ControlValues[K] | null,
		adapterId: holder.value.adapterId ?? null,
	};
}

export interface PageMediaProbe {
	readonly supported: boolean;
	/** Present when the host matched a declared row, even if discovery failed. */
	readonly adapterId: string | null;
}

// post: reports whether an amplified page volume controller exists for this
// element WITHOUT any read or write — page-entry solidification depends on
// this being side-effect-free.
export function probePageMediaCapability(
	element: HTMLMediaElement,
	field: SpectraPageMediaField,
): boolean {
	return probePageMediaDetail(element, field).supported;
}

export function probePageMediaDetail(
	element: HTMLMediaElement,
	field: SpectraPageMediaField,
): PageMediaProbe {
	const holder: { value: SpectraPageMediaResult | null } = { value: null };
	try {
		const supported = dispatch(element, {
			requestId: crypto.randomUUID(),
			operation: 'probe',
			field,
		}, holder) !== null;
		return { supported, adapterId: holder.value?.adapterId ?? null };
	} catch {
		return { supported: false, adapterId: null };
	}
}

export function writePageMediaField(
	element: HTMLMediaElement,
	field: SpectraPageMediaField,
	value: ControlValues[SpectraPageMediaField],
): ControlValues[SpectraPageMediaField] | null {
	return dispatch(element, {
		requestId: crypto.randomUUID(),
		operation: 'write',
		field,
		value,
	});
}
