// goal: discover an exact-media page controller and execute synchronous semantic read/write ACKs in MAIN
//
// Discovery is deliberately two-tier. The generic heuristics stay the default
// for every site; a declared site adapter only reorders and widens the probe for
// the hosts that have one, and every answer it produces is attributable through
// `adapterId`. That keeps the MAIN surface at exactly one allowlisted script
// (SCTRL-004) while ending the situation where a single player's naming
// convention silently degrades to `dom-native`.

import {
	SPECTRA_PAGE_MEDIA_EVENT,
	SPECTRA_PAGE_MEDIA_FIELDS,
	SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE,
	SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE,
	type SpectraPageMediaField,
	type SpectraPageMediaRequest,
	type SpectraPageMediaResult,
	type SpectraPageMediaValue,
} from '../../shared/page-media-bridge';
import {
	GENERIC_PAGE_MEDIA_VOCABULARY,
	SITE_ADAPTER_LIMITS,
	resolveSiteAdapter,
	siteAdapterBounds,
	type SiteAdapterEntry,
	type SiteSpeedProjectionSpec,
} from '../../shared/site-adapter-registry';
import { CONTROL_VALUE_LIMITS } from '@nexus/contracts';

interface MainPageMediaWindow extends Window {
	__SPECTRA_PAGE_MEDIA_BRIDGE_V2__?: true;
}

interface PageMediaCapability {
	read(): SpectraPageMediaValue;
	write(value: SpectraPageMediaValue): void;
}

interface ResolvedCapability {
	capability: PageMediaCapability;
	/** True when a declared name or key — not a generic heuristic — found it. */
	declared: boolean;
}

interface ControllerCandidate {
	controller: object;
	distance: number;
	association: 'ancestor' | 'media-reference' | 'root-reference';
	declared: boolean;
}

const pageMediaFields = new Set<string>(SPECTRA_PAGE_MEDIA_FIELDS);
const VOLUME_LIMIT = CONTROL_VALUE_LIMITS.nativeVolume;
const SPEED_LIMIT = CONTROL_VALUE_LIMITS.speed;
const GENERIC_ASSOCIATION_KEYS = GENERIC_PAGE_MEDIA_VOCABULARY.mediaReferenceKeys;
const GENERIC_ROOT_KEYS = GENERIC_PAGE_MEDIA_VOCABULARY.rootReferenceKeys;
/**
 * Sets, because `capabilityFor` must be able to ask "is this name one generic
 * discovery already knew?". A declared row that merely repeats a generic name
 * must not claim priority over a nearer generic controller — otherwise every
 * candidate on the page looks declared and the ordering collapses back to
 * distance, which is the bug the registry exists to fix.
 */
const GENERIC_SPEED_SETTERS = new Set(GENERIC_PAGE_MEDIA_VOCABULARY.speedSetterNames);
const GENERIC_SPEED_GETTERS = new Set(GENERIC_PAGE_MEDIA_VOCABULARY.speedGetterNames);
const GENERIC_SPEED_ACCESSORS = new Set(GENERIC_PAGE_MEDIA_VOCABULARY.speedAccessorNames);
const REACT_MOUNT_KEY = /^__(?:reactFiber|reactInternalInstance|reactProps)\$/;
const DEFAULT_BOUNDS = siteAdapterBounds(null);

function adapterFor(field: SpectraPageMediaField): SiteAdapterEntry | null {
	const hostname = location.hostname;
	return typeof hostname === 'string' ? resolveSiteAdapter(hostname, field) : null;
}

const SPEED_ADAPTER = adapterFor('speed');
const VOLUME_ADAPTER = adapterFor('volumeBase');
const MUTE_ADAPTER = adapterFor('mediaMuted');
const ADAPTERS: Readonly<Record<SpectraPageMediaField, SiteAdapterEntry | null>> = Object.freeze({
	volumeBase: VOLUME_ADAPTER,
	mediaMuted: MUTE_ADAPTER,
	speed: SPEED_ADAPTER,
});

function boundsFor(adapter: SiteAdapterEntry | null): {
	maxAncestorDepth: number;
	maxAttachedProperties: number;
	maxPrototypeDepth: number;
} {
	return adapter ? siteAdapterBounds(adapter.discovery) : DEFAULT_BOUNDS;
}

function composedParent(element: Element): Element | null {
	if (element.parentElement) return element.parentElement;
	const root = element.getRootNode();
	return root instanceof ShadowRoot ? root.host : null;
}

function propertyDescriptor(
	target: object,
	key: PropertyKey,
	maxDepth = DEFAULT_BOUNDS.maxPrototypeDepth,
): PropertyDescriptor | null {
	let current: object | null = target;
	for (let depth = 0; current && depth < maxDepth; depth += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(current, key);
		if (descriptor) return descriptor;
		current = Object.getPrototypeOf(current) as object | null;
	}
	return null;
}

function dataProperty(target: object, key: PropertyKey): unknown {
	const descriptor = propertyDescriptor(target, key);
	return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function boundMethod(target: object, name: string): ((...args: unknown[]) => unknown) | null {
	const candidate = dataProperty(target, name);
	return typeof candidate === 'function'
		? (...args: unknown[]) => Reflect.apply(candidate, target, args)
		: null;
}

function accessorCapability(
	target: object,
	property: string,
): PageMediaCapability | null {
	const descriptor = propertyDescriptor(target, property);
	const getter = descriptor?.get;
	const setter = descriptor?.set;
	if (!getter || !setter) return null;
	return {
		read: () => Reflect.apply(getter, target, []),
		write: (value) => { Reflect.apply(setter, target, [value]); },
	};
}

function finiteNumber(value: unknown, minimum: number, maximum: number, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
		throw new Error(`${label} getter returned an invalid value`);
	}
	return value;
}

function booleanValue(value: unknown, label: string): boolean {
	if (typeof value !== 'boolean') throw new Error(`${label} getter returned an invalid value`);
	return value;
}

function playbackRatePropertyReader(
	target: object,
	maxPrototypeDepth: number,
): (() => number) | null {
	const descriptor = propertyDescriptor(target, 'playbackRate', maxPrototypeDepth);
	if (!descriptor
		|| (!descriptor.get && (!('value' in descriptor) || typeof descriptor.value !== 'number'))) {
		return null;
	}
	return () => finiteNumber(
		Reflect.get(target, 'playbackRate'),
		SPEED_LIMIT.min,
		SPEED_LIMIT.max,
		'Page playback rate',
	);
}

function resolveSpeedAccessor(
	controller: object,
	adapter: SiteAdapterEntry | null,
): ResolvedCapability | null {
	const declaredNames = adapter?.discovery.accessorNames ?? [];
	for (const name of declaredNames) {
		const accessor = accessorCapability(controller, name);
		if (!accessor || controller instanceof HTMLMediaElement) continue;
		return { capability: accessor, declared: !GENERIC_SPEED_ACCESSORS.has(name) };
	}
	const generic = accessorCapability(controller, 'playbackRate');
	return generic && !(controller instanceof HTMLMediaElement)
		? { capability: generic, declared: false }
		: null;
}

function capabilityFor(
	controller: object,
	field: SpectraPageMediaField,
): ResolvedCapability | null {
	const adapter = ADAPTERS[field];
	if (field === 'volumeBase') {
		const getVolume = boundMethod(controller, 'getVolume');
		const setVolume = boundMethod(controller, 'setVolume');
		if (!getVolume || !setVolume) return null;
		return { declared: false, capability: {
			read: () => finiteNumber(getVolume(), VOLUME_LIMIT.min, VOLUME_LIMIT.max, 'Page volume'),
			write: (value) => {
				setVolume(finiteNumber(value, VOLUME_LIMIT.min, VOLUME_LIMIT.max, 'Requested volume'));
			},
		} };
	}
	if (field === 'mediaMuted') {
		const isMuted = boundMethod(controller, 'isMuted') ?? boundMethod(controller, 'getMuted');
		const setMuted = boundMethod(controller, 'setMuted');
		const mute = boundMethod(controller, 'mute');
		const unMute = boundMethod(controller, 'unMute') ?? boundMethod(controller, 'unmute');
		if (isMuted && setMuted) {
			return { declared: false, capability: {
				read: () => booleanValue(isMuted(), 'Page mute'),
				write: (value) => {
					const muted = booleanValue(value, 'Requested mute');
					setMuted(muted);
				},
			} };
		}
		if (isMuted && mute && unMute) {
			return { declared: false, capability: {
				read: () => booleanValue(isMuted(), 'Page mute'),
				write: (value) => {
					const muted = booleanValue(value, 'Requested mute');
					if (muted) mute();
					else unMute();
				},
			} };
		}
		const accessor = accessorCapability(controller, 'muted');
		return accessor && !(controller instanceof HTMLMediaElement)
			? { declared: false, capability: {
				read: () => booleanValue(accessor.read(), 'Page mute'),
				write: (value) => accessor.write(booleanValue(value, 'Requested mute')),
			} }
			: null;
	}

	let readPlaybackRate: (() => number) | null = null;
	let declaredRead = false;
	for (const name of adapter?.discovery.getterNames ?? []) {
		const getter = boundMethod(controller, name);
		if (!getter) continue;
		readPlaybackRate = () => finiteNumber(
			getter(),
			SPEED_LIMIT.min,
			SPEED_LIMIT.max,
			'Page playback rate',
		);
		declaredRead = !GENERIC_SPEED_GETTERS.has(name);
		break;
	}
	if (!readPlaybackRate) {
		const getPlaybackRate = boundMethod(controller, 'getPlaybackRate');
		readPlaybackRate = getPlaybackRate
			? () => finiteNumber(getPlaybackRate(), SPEED_LIMIT.min, SPEED_LIMIT.max, 'Page playback rate')
			: playbackRatePropertyReader(controller, boundsFor(adapter).maxPrototypeDepth);
	}

	let setPlaybackRate: ((...args: unknown[]) => unknown) | null = null;
	let declaredWrite = false;
	for (const name of adapter?.discovery.setterNames ?? []) {
		const setter = boundMethod(controller, name);
		if (!setter) continue;
		setPlaybackRate = setter;
		declaredWrite = !GENERIC_SPEED_SETTERS.has(name);
		break;
	}
	if (!setPlaybackRate) {
		for (const name of GENERIC_SPEED_SETTERS) {
			const setter = boundMethod(controller, name);
			if (!setter) continue;
			setPlaybackRate = setter;
			break;
		}
	}
	if (readPlaybackRate && setPlaybackRate) {
		const setter = setPlaybackRate;
		return { declared: declaredRead || declaredWrite, capability: {
			read: readPlaybackRate,
			write: (value) => {
				setter(finiteNumber(value, SPEED_LIMIT.min, SPEED_LIMIT.max, 'Requested playback rate'));
			},
		} };
	}
	return resolveSpeedAccessor(controller, adapter);
}

function controllerAssociation(
	controller: object,
	element: HTMLMediaElement,
	host: Element,
	adapter: SiteAdapterEntry | null,
): { association: ControllerCandidate['association']; declared: boolean } | null {
	for (const key of adapter?.discovery.associationKeys ?? []) {
		if (dataProperty(controller, key) === element) {
			return { association: 'media-reference', declared: true };
		}
	}
	for (const key of GENERIC_ASSOCIATION_KEYS) {
		if (dataProperty(controller, key) === element) {
			return { association: 'media-reference', declared: false };
		}
	}
	for (const key of GENERIC_ROOT_KEYS) {
		const root = dataProperty(controller, key);
		if (root instanceof Element && (root === host || root.contains(element))) {
			return { association: 'root-reference', declared: false };
		}
	}
	return null;
}

/**
 * React attaches its mount records as own symbol-ish string keys on the host
 * node. `stateNode` is the class/function instance the player actually drives,
 * which is where a SPA keeps the controller its own UI calls. The walk is
 * bounded by the row (`followReactFiber`) so no other site pays for it, and by
 * `maxReactFiberDepth` so a pathological tree cannot stall discovery.
 */
function reactFiberControllers(
	host: Element,
	adapter: SiteAdapterEntry | null,
): object[] {
	if (!adapter?.discovery.followReactFiber) return [];
	const found: object[] = [];
	for (const key of Object.getOwnPropertyNames(host)) {
		if (!REACT_MOUNT_KEY.test(key)) continue;
		let node: unknown = dataProperty(host, key);
		for (let depth = 0; depth < SITE_ADAPTER_LIMITS.maxReactFiberDepth; depth += 1) {
			if (!node || typeof node !== 'object') break;
			const stateNode: unknown = dataProperty(node, 'stateNode');
			if (stateNode && typeof stateNode === 'object') found.push(stateNode);
			node = dataProperty(node, 'return');
		}
	}
	return found;
}

function collectControllerCandidates(
	element: HTMLMediaElement,
	adapter: SiteAdapterEntry | null,
): ControllerCandidate[] {
	const bounds = boundsFor(adapter);
	const candidates = new Map<object, ControllerCandidate>();
	const consider = (
		controller: object,
		distance: number,
		host: Element,
	): void => {
		if (candidates.has(controller)) return;
		const association = controllerAssociation(controller, element, host, adapter);
		if (!association) return;
		candidates.set(controller, {
			controller,
			distance,
			association: association.association,
			declared: association.declared,
		});
	};
	let host = composedParent(element);
	for (let distance = 1; host && distance <= bounds.maxAncestorDepth; distance += 1) {
		candidates.set(host, { controller: host, distance, association: 'ancestor', declared: false });
		for (const key of Object.getOwnPropertyNames(host).slice(0, bounds.maxAttachedProperties)) {
			const value = dataProperty(host, key);
			if ((!value || typeof value !== 'object') && typeof value !== 'function') continue;
			consider(value as object, distance, host);
		}
		for (const controller of reactFiberControllers(host, adapter)) {
			consider(controller, distance, host);
		}
		host = composedParent(host);
	}
	return [...candidates.values()];
}

function capabilityCount(controller: object): number {
	return SPECTRA_PAGE_MEDIA_FIELDS.reduce(
		(count, field) => count + (capabilityFor(controller, field) ? 1 : 0),
		0,
	);
}

function associationRank(value: ControllerCandidate['association']): number {
	return value === 'media-reference' ? 2 : value === 'root-reference' ? 1 : 0;
}

interface FoundCapability {
	capability: PageMediaCapability;
	adapterId: string | null;
}

function findCapability(
	element: HTMLMediaElement,
	field: SpectraPageMediaField,
): FoundCapability | null {
	const adapter = ADAPTERS[field];
	const ranked = collectControllerCandidates(element, adapter)
		.map((candidate) => {
			const resolved = capabilityFor(candidate.controller, field);
			return {
				...candidate,
				declared: candidate.declared || (resolved?.declared ?? false),
				capability: resolved?.capability ?? null,
				capabilityCount: resolved ? capabilityCount(candidate.controller) : 0,
			};
		})
		.filter((candidate): candidate is typeof candidate & { capability: PageMediaCapability } => (
			candidate.capability !== null
		))
		.sort((left, right) => {
			// Declared knowledge outranks every heuristic: a row exists precisely
			// because the generic ordering picked the wrong object here.
			return (right.declared ? 1 : 0) - (left.declared ? 1 : 0)
				// Exact media/root ownership outranks feature count. Otherwise a broad
				// outer player with three generic methods could steal a field from the
				// explicitly associated controller of a nested media element.
				|| associationRank(right.association) - associationRank(left.association)
				|| left.distance - right.distance
				|| right.capabilityCount - left.capabilityCount;
		});
	const winner = ranked[0];
	if (!winner) return null;
	return {
		capability: winner.capability,
		adapterId: adapter && winner.declared ? adapter.id : null,
	};
}

/**
 * Read the badge the player renders. This is the only channel that reports what
 * the UI shows; `playbackRate` cannot, which is the entire Douyin failure.
 * Returning `null` means "unreadable right now" and is never treated as
 * agreement.
 */
function scanProjectionText(
	root: Element,
	spec: SiteSpeedProjectionSpec,
): number | null {
	const patterns = spec.patterns.map((source) => new RegExp(source));
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let budget = SITE_ADAPTER_LIMITS.maxProjectionTextNodes;
	for (let node = walker.nextNode(); node && budget > 0; node = walker.nextNode()) {
		budget -= 1;
		const text = node.nodeValue?.trim();
		if (!text || text.length > 24) continue;
		for (const pattern of patterns) {
			const match = pattern.exec(text);
			const captured = match?.[1];
			if (!captured) continue;
			const value = Number.parseFloat(captured);
			if (!Number.isFinite(value) || value < SPEED_LIMIT.min || value > SPEED_LIMIT.max) continue;
			return value;
		}
	}
	return null;
}

function readSpeedProjection(
	element: HTMLMediaElement,
	spec: SiteSpeedProjectionSpec | null,
): number | null {
	if (!spec) return null;
	const roots: Element[] = [];
	for (const selector of spec.scopeSelectors.slice(0, SITE_ADAPTER_LIMITS.maxProjectionScopes)) {
		let scope: Element | null = null;
		try {
			scope = document.querySelector(selector);
		} catch {
			// An invalid selector in a declared row must not take the bridge down;
			// the row is data and the runbook is what validates it.
			continue;
		}
		if (scope) roots.push(scope);
	}
	let host = composedParent(element);
	for (
		let depth = 1;
		host && depth <= SITE_ADAPTER_LIMITS.maxProjectionAncestors;
		depth += 1
	) {
		roots.push(host);
		host = composedParent(host);
	}
	for (const root of roots) {
		const value = scanProjectionText(root, spec);
		if (value !== null) return value;
	}
	return null;
}

function projectionFor(
	element: HTMLMediaElement,
	field: SpectraPageMediaField,
): SpectraPageMediaValue | null {
	const adapter = ADAPTERS[field];
	if (!adapter || field !== 'speed' || !adapter.projection) return null;
	return readSpeedProjection(element, adapter.projection);
}

function decodeRequest(element: HTMLMediaElement): SpectraPageMediaRequest | null {
	const encoded = element.getAttribute(SPECTRA_PAGE_MEDIA_REQUEST_ATTRIBUTE);
	if (!encoded) return null;
	try {
		const request = JSON.parse(encoded) as Partial<SpectraPageMediaRequest>;
		if (typeof request.requestId !== 'string' || request.requestId.length === 0
			|| (request.operation !== 'read' && request.operation !== 'write' && request.operation !== 'probe')
			|| typeof request.field !== 'string' || !pageMediaFields.has(request.field)) return null;
		if (request.operation !== 'write') {
			return { requestId: request.requestId, operation: request.operation, field: request.field as SpectraPageMediaField };
		}
		const valueValid = request.field === 'mediaMuted'
			? typeof request.value === 'boolean'
			: typeof request.value === 'number' && Number.isFinite(request.value);
		return valueValid ? request as SpectraPageMediaRequest : null;
	} catch {
		return null;
	}
}

function valuesMatch(
	field: SpectraPageMediaField,
	expected: SpectraPageMediaValue,
	actual: SpectraPageMediaValue,
): boolean {
	if (field === 'mediaMuted') return expected === actual;
	return typeof expected === 'number' && typeof actual === 'number'
		&& Math.abs(expected - actual) <= 0.005;
}

function onPageMediaRequest(event: Event): void {
	const element = event.target;
	if (!(element instanceof HTMLMediaElement)) return;
	const request = decodeRequest(element);
	if (!request) return;
	const adapterId = ADAPTERS[request.field]?.id;
	// A probe is pure capability discovery: no read, no write, no page-visible
	// side effect. Page-entry solidification uses it to record, per site, whether
	// an amplified page volume controller exists.
	if (request.operation === 'probe') {
		const found = findCapability(element, request.field);
		const probeResult: SpectraPageMediaResult = {
			requestId: request.requestId,
			field: request.field,
			supported: found !== null,
			actual: null,
			...(found?.adapterId ? { adapterId: found.adapterId } : {}),
			...(adapterId && !found ? { adapterId } : {}),
		};
		element.setAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE, JSON.stringify(probeResult));
		return;
	}
	const found = findCapability(element, request.field);
	if (!found) {
		const unsupported: SpectraPageMediaResult = {
			requestId: request.requestId,
			field: request.field,
			supported: false,
			actual: null,
		};
		element.setAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE, JSON.stringify(unsupported));
		return;
	}
	const capability = found.capability;

	let before: SpectraPageMediaValue | null = null;
	let requestedValue: SpectraPageMediaValue | undefined;
	let result: SpectraPageMediaResult;
	try {
		before = capability.read();
		if (request.operation === 'write') {
			requestedValue = request.value;
			if (requestedValue === undefined) throw new Error('Page media write request has no value');
			capability.write(requestedValue);
		}
		const actual = capability.read();
		if (requestedValue !== undefined && !valuesMatch(request.field, requestedValue, actual)) {
			capability.write(before);
			const restored = capability.read();
			throw new Error(
				`Page ${request.field} readback mismatch; baseline ${valuesMatch(request.field, before, restored) ? 'restored' : 'restore failed'}`,
			);
		}
		result = {
			requestId: request.requestId,
			field: request.field,
			supported: true,
			actual,
			// A projection read is a witness, never a gate: the badge may render a
			// frame after the setter returns, so gating here would fail writes that
			// the site itself is about to honour. The confirmation step owns the
			// verdict, after the render boundary.
			...(found.adapterId ? { adapterId: found.adapterId } : {}),
			...(ADAPTERS[request.field]?.projection
				? { projection: projectionFor(element, request.field) }
				: {}),
		};
	} catch (error) {
		let rollbackError: unknown = null;
		if (request.operation === 'write' && before !== null) {
			try {
				const current = capability.read();
				if (!valuesMatch(request.field, current, before)) capability.write(before);
			} catch (caughtRollbackError) {
				// The returned failure remains authoritative; executor ownership is not committed.
				rollbackError = caughtRollbackError;
			}
		}
		const primaryMessage = error instanceof Error ? error.message : String(error);
		result = {
			requestId: request.requestId,
			field: request.field,
			supported: true,
			actual: null,
			error: rollbackError === null
				? primaryMessage
				: `${primaryMessage}; baseline rollback failed: ${
					rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
				}`,
		};
	}
	element.setAttribute(SPECTRA_PAGE_MEDIA_RESULT_ATTRIBUTE, JSON.stringify(result));
}

const mainWindow = window as MainPageMediaWindow;
if (!mainWindow.__SPECTRA_PAGE_MEDIA_BRIDGE_V2__) {
	mainWindow.__SPECTRA_PAGE_MEDIA_BRIDGE_V2__ = true;
	document.addEventListener(SPECTRA_PAGE_MEDIA_EVENT, onPageMediaRequest, true);
}
