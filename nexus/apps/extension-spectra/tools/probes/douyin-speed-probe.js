// goal: attribute the Douyin speed sync failure on a real tab without mutating anything by default
// usage: DevTools console on the target tab -> paste this file -> __SPECTRA_DOUYIN_PROBE__.run()
// inv: read-only until tryWrite() is called explicitly; every tryWrite restores the pre-probe rate
//
// Tiers
//   T0  ask the shipped allowlisted bridge (content-page-media-bridge.js) whether it can see `speed`
//   T1  replay the bridge's discovery heuristics with instrumentation and explain every near miss
//   T2  locate the player's speed label and capture its rendering path
//   T3  opt-in: call one candidate setter at a time and observe whether the label follows
(() => {
	const VERSION = "1.0.0";
	const SPEED_MIN = 0.1;
	const SPEED_MAX = 16;
	const SPEED_TOLERANCE = 0.005;

	// Protocol constants are duplicated on purpose: this file must run with no imports.
	const BRIDGE_REQUEST = "data-spectra-page-media-request-v2";
	const BRIDGE_RESULT = "data-spectra-page-media-result-v2";
	const BRIDGE_EVENT = "spectra:page-media:v2";

	// The shipped bridge's literal limits, copied from src/content/injector/page-media-bridge.ts.
	const BRIDGE_LIMITS = { ancestorDepth: 12, attachedProperties: 96, prototypeDepth: 8 };
	const LEGACY_SETTERS = ["setPlaybackRate", "setPlaybackRateByUser", "changePlaybackRate"];
	const LEGACY_MEDIA_KEYS = ["video", "media", "mediaElement", "element"];
	const LEGACY_ROOT_KEYS = ["root", "el", "container"];

	// Deliberately wider than the bridge: these are hypotheses to test, never write targets.
	const EXTENDED_MEDIA_KEYS = LEGACY_MEDIA_KEYS.concat([
		"videoEl",
		"videoElement",
		"videoRef",
		"mediaEl",
		"mediaNode",
		"player",
		"playerCore",
		"instance",
		"_video",
		"$video",
		"videoNode",
		"ref",
		"current",
		"target",
	]);
	const EXTENDED_ROOT_KEYS = LEGACY_ROOT_KEYS.concat(["wrapper", "host", "mount", "dom", "node"]);

	const SPEED_NAME = /(speed|playback|rate)/i;
	const SETTER_NAME = /^(set|update|change|apply|select|choose|toggle)/i;
	const GETTER_NAME = /^(get|read|is|has)/i;
	const FIBER_KEY = /^__react(Fiber|Props|InternalInstance)\$/;
	const LABEL_PATTERN = /(\d+(?:\.\d+)?)\s*(倍|×|[xX](?![a-zA-Z]))/;
	const MAX_TEXT_NODES = 4000;
	const MAX_SHADOW_HOSTS = 5000;
	const MAX_SETTER_ATTEMPTS = 8;
	const PROBE_OPTIONS = {
		maxAncestorDepth: 24,
		maxAttachedProperties: 256,
		propertyScanDepth: 8,
	};

	const READ_ONLY_OPTIONS = Object.freeze({ ...PROBE_OPTIONS });

	function safeGet(object, key) {
		try {
			return object[key];
		} catch {
			return undefined;
		}
	}

	function isObjectLike(value) {
		return value !== null && (typeof value === "object" || typeof value === "function");
	}

	function constructorName(value) {
		try {
			return value?.constructor?.name ?? "Object";
		} catch {
			return "unknown";
		}
	}

	function describeValue(value) {
		if (value === null) return "null";
		const type = typeof value;
		if (type === "function") return `fn/${value.length}`;
		if (type === "number" || type === "boolean" || type === "undefined") return String(value);
		if (type === "string") return JSON.stringify(value.length > 24 ? `${value.slice(0, 24)}…` : value);
		if (typeof HTMLMediaElement !== "undefined" && value instanceof HTMLMediaElement) {
			return `<${value.tagName.toLowerCase()}>`;
		}
		if (typeof Element !== "undefined" && value instanceof Element) {
			const className = typeof value.className === "string" ? value.className.trim().split(/\s+/)[0] : "";
			return `<${value.tagName.toLowerCase()}${className ? `.${className.slice(0, 18)}` : ""}>`;
		}
		if (Array.isArray(value)) return `array/${value.length}`;
		return constructorName(value);
	}

	function composedParent(element) {
		if (element.parentElement) return element.parentElement;
		const root = element.getRootNode?.();
		return root?.host ?? null;
	}

	function isVisible(element) {
		if (!element || typeof element.getClientRects !== "function") return false;
		if (element.getClientRects().length === 0) return false;
		const style = getComputedStyle(element);
		return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
	}

	function cssPath(element, depth = 5) {
		const parts = [];
		let current = element;
		for (let step = 0; current && current.nodeType === 1 && step < depth; step += 1) {
			let part = current.tagName.toLowerCase();
			const className = typeof current.className === "string" ? current.className.trim().split(/\s+/)[0] : "";
			if (className) part += `.${className.slice(0, 24)}`;
			else if (current.id) part += `#${current.id}`;
			parts.unshift(part);
			current = current.parentElement;
		}
		return parts.join(" > ");
	}

	// ---------------------------------------------------------------- media target

	function collectMedia() {
		const found = new Set(document.querySelectorAll("video,audio"));
		const hosts = document.querySelectorAll("*");
		const limit = Math.min(hosts.length, MAX_SHADOW_HOSTS);
		for (let index = 0; index < limit; index += 1) {
			const shadow = hosts[index].shadowRoot;
			if (!shadow) continue;
			for (const element of shadow.querySelectorAll("video,audio")) found.add(element);
		}
		return [...found];
	}

	function mediaScore(element) {
		const rect = element.getBoundingClientRect();
		const area = Math.max(0, rect.width) * Math.max(0, rect.height);
		const playing = element.paused || element.ended ? 0 : 1;
		const ready = element.readyState >= 2 ? 1 : 0;
		return area * (1 + playing * 2 + ready) + (element.currentSrc ? 1 : 0);
	}

	function listMedia() {
		return collectMedia()
			.map((element, index) => {
				const rect = element.getBoundingClientRect();
				return {
					element,
					index,
					score: mediaScore(element),
					tag: element.tagName.toLowerCase(),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
					paused: element.paused,
					readyState: element.readyState,
					duration: Number.isFinite(element.duration) ? Number(element.duration.toFixed(2)) : null,
					playbackRate: element.playbackRate,
					hasSource: Boolean(element.currentSrc || element.src || element.srcObject),
				};
			})
			.sort((left, right) => right.score - left.score);
	}

	// ---------------------------------------------------------------- T0 shipped bridge

	function bridgeProbe(element, field = "speed") {
		const requestId = `spectra-probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const installed = Boolean(window.__SPECTRA_PAGE_MEDIA_BRIDGE_V2__);
		let supported = false;
		let actual = null;
		let adapterId = null;
		let error = null;
		try {
			element.setAttribute(
				BRIDGE_REQUEST,
				JSON.stringify({ requestId, operation: "probe", field }),
			);
			element.removeAttribute(BRIDGE_RESULT);
			element.dispatchEvent(new Event(BRIDGE_EVENT, { bubbles: true, composed: true }));
			const raw = element.getAttribute(BRIDGE_RESULT);
			if (!raw) {
				error = "no result attribute: bridge listener absent or event not observed";
			} else {
				const parsed = JSON.parse(raw);
				if (parsed.requestId !== requestId) error = "stale result: another transact answered first";
				supported = parsed.supported === true;
				actual = parsed.actual ?? null;
				// Present once a declared site adapter answered. A non-null value
				// means the shipped bridge already has site knowledge for this host,
				// so the T1 attribution below is a cross-check, not the last word.
				adapterId = parsed.adapterId ?? null;
			}
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			element.removeAttribute(BRIDGE_REQUEST);
			element.removeAttribute(BRIDGE_RESULT);
		}
		return { installed, field, supported, actual, adapterId, error };
	}

	// ---------------------------------------------------------------- T1 discovery replay

	function associationOf(controller, element, host) {
		for (const key of EXTENDED_MEDIA_KEYS) {
			if (safeGet(controller, key) === element) {
				return { kind: "media-reference", key, legacy: LEGACY_MEDIA_KEYS.includes(key) };
			}
		}
		for (const key of EXTENDED_ROOT_KEYS) {
			const root = safeGet(controller, key);
			if (root && root.nodeType === 1 && (root === host || root.contains?.(element))) {
				return { kind: "root-reference", key, legacy: LEGACY_ROOT_KEYS.includes(key) };
			}
		}
		// One level of indirection: { video: { current: <video> } } and friends.
		for (const key of EXTENDED_MEDIA_KEYS) {
			const holder = safeGet(controller, key);
			if (!holder || typeof holder !== "object") continue;
			for (const inner of ["current", "video", "el", "media", "element", "node"]) {
				if (safeGet(holder, inner) === element) {
					return { kind: "media-reference", key: `${key}.${inner}`, legacy: false };
				}
			}
		}
		return null;
	}

	function scanSpeedSurface(target) {
		const surface = [];
		const seen = new Set();
		let current = target;
		let prototypeDepth = 0;
		while (current && prototypeDepth <= PROBE_OPTIONS.propertyScanDepth) {
			let names;
			try {
				names = Object.getOwnPropertyNames(current);
			} catch {
				break;
			}
			for (const name of names) {
				if (name === "constructor" || seen.has(name)) continue;
				// Chrome exposes IDL event-handler attributes (onratechange, …) on
				// HTMLElement.prototype, so every element would otherwise look like
				// a speed controller.
				if (/^on[a-z]/.test(name)) continue;
				if (!SPEED_NAME.test(name)) continue;
				let descriptor = null;
				try {
					descriptor = Object.getOwnPropertyDescriptor(current, name);
				} catch {
					descriptor = null;
				}
				if (!descriptor) continue;
				seen.add(name);
				const entry = {
					name,
					ownOn: prototypeDepth === 0 ? "candidate" : `prototype+${prototypeDepth}`,
					kind: "value",
					arity: null,
					bridgeCompatible: false,
				};
				if (typeof descriptor.value === "function") {
					entry.arity = descriptor.value.length;
					entry.kind = GETTER_NAME.test(name) && !SETTER_NAME.test(name)
						? "getter"
						: SETTER_NAME.test(name)
							? "setter"
							: "method";
					entry.bridgeCompatible = LEGACY_SETTERS.includes(name) || name === "getPlaybackRate";
				} else if (descriptor.get || descriptor.set) {
					entry.kind = "accessor";
					entry.bridgeCompatible = name === "playbackRate";
				} else if (typeof descriptor.value === "number") {
					entry.kind = "numeric-state";
				}
				surface.push(entry);
			}
			current = Object.getPrototypeOf(current);
			prototypeDepth += 1;
		}
		return surface;
	}

	function bridgeAcceptance(candidate) {
		const reasons = [];
		if (candidate.associationKind === "react-fiber") reasons.push("association-kind");
		if (candidate.associationKind === "media-reference" || candidate.associationKind === "root-reference") {
			if (!candidate.legacyAssociation) reasons.push("association-key");
		}
		if (candidate.propertyIndex >= BRIDGE_LIMITS.attachedProperties) reasons.push("property-index");
		if (candidate.ancestorDepth > BRIDGE_LIMITS.ancestorDepth) reasons.push("ancestor-depth");
		const surface = candidate.speedSurface;
		const reader = surface.some(
			(entry) => (entry.kind === "getter" && entry.name === "getPlaybackRate")
				|| (entry.kind === "accessor" && entry.name === "playbackRate" && !(candidate.controller instanceof HTMLMediaElement)),
		);
		if (!reader) reasons.push("getter-name");
		if (!surface.some((entry) => entry.kind === "setter" && LEGACY_SETTERS.includes(entry.name))) {
			reasons.push("setter-name");
		}
		return { accepted: reasons.length === 0, reasons };
	}

	function collectCandidates(element) {
		const collected = new Map();
		let host = composedParent(element);
		let ancestorDepth = 1;
		while (host && ancestorDepth <= PROBE_OPTIONS.maxAncestorDepth) {
			const ownNames = Object.getOwnPropertyNames(host);
			collected.set(host, {
				controller: host,
				controllerName: describeValue(host),
				ancestorDepth,
				propertyIndex: -1,
				propertyName: null,
				associationKind: "ancestor",
				associationKey: null,
				legacyAssociation: true,
				ownPropertyCount: ownNames.length,
			});
			const limit = Math.min(ownNames.length, PROBE_OPTIONS.maxAttachedProperties);
			for (let propertyIndex = 0; propertyIndex < limit; propertyIndex += 1) {
				const propertyName = ownNames[propertyIndex];
				const value = safeGet(host, propertyName);
				if (!isObjectLike(value) || collected.has(value)) continue;
				const association = associationOf(value, element, host);
				const fiber = FIBER_KEY.test(propertyName);
				if (!association && !fiber) continue;
				collected.set(value, {
					controller: value,
					controllerName: describeValue(value),
					ancestorDepth,
					propertyIndex,
					propertyName,
					associationKind: association?.kind ?? "react-fiber",
					associationKey: association?.key ?? propertyName,
					legacyAssociation: association?.legacy === true,
					ownPropertyCount: ownNames.length,
				});
			}
			host = composedParent(host);
			ancestorDepth += 1;
		}
		const candidates = [];
		for (const candidate of collected.values()) {
			const speedSurface = scanSpeedSurface(candidate.controller);
			if (speedSurface.length === 0 && candidate.associationKind !== "media-reference") continue;
			const acceptance = bridgeAcceptance({ ...candidate, speedSurface });
			candidates.push({ ...candidate, speedSurface, ...acceptance });
		}
		return candidates.sort(
			(left, right) => left.ancestorDepth - right.ancestorDepth || left.propertyIndex - right.propertyIndex,
		);
	}

	function summarizeDiscovery(candidates) {
		const nearMisses = candidates
			.filter((candidate) => !candidate.accepted)
			.filter(
				(candidate) => candidate.speedSurface.some(
					(entry) => entry.kind === "setter" || entry.kind === "accessor" || entry.name === "playbackRate",
				),
			)
			.map((candidate) => ({
				controller: candidate.controllerName,
				ancestorDepth: candidate.ancestorDepth,
				propertyName: candidate.propertyName,
				propertyIndex: candidate.propertyIndex,
				ownPropertyCount: candidate.ownPropertyCount,
				associationKind: candidate.associationKind,
				associationKey: candidate.associationKey,
				rejectionReasons: candidate.reasons,
				speedNames: candidate.speedSurface.map((entry) => `${entry.name}:${entry.kind}`),
			}));
		const reasonCounts = {};
		for (const nearMiss of nearMisses) {
			for (const reason of nearMiss.rejectionReasons) {
				reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
			}
		}
		return { nearMisses, reasonCounts };
	}

	// ---------------------------------------------------------------- T2 UI projection

	function labelSnapshot() {
		const labels = [];
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const text = node.nodeValue;
				if (!text || text.length > 32 || !/\d/.test(text)) return NodeFilter.FILTER_REJECT;
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let visited = 0;
		let node = walker.nextNode();
		while (node && visited < MAX_TEXT_NODES) {
			visited += 1;
			const raw = node.nodeValue.trim();
			const match = raw.match(LABEL_PATTERN);
			if (match) {
				const value = Number(match[1]);
				const element = node.parentElement;
				if (Number.isFinite(value) && value >= SPEED_MIN && value <= SPEED_MAX && isVisible(element)) {
					labels.push({
						text: raw,
						value,
						path: cssPath(element),
						confidence: raw.includes("倍") || raw.includes("×") ? "high" : "low",
						anchor: element,
					});
				}
			}
			node = walker.nextNode();
		}
		return labels;
	}

	function labelDistances(labels, target) {
		const rect = target.getBoundingClientRect();
		const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		return labels.map((label) => {
			const labelRect = label.anchor.getBoundingClientRect();
			const dx = labelRect.left + labelRect.width / 2 - center.x;
			const dy = labelRect.top + labelRect.height / 2 - center.y;
			return {
				...label,
				distancePx: Math.round(Math.hypot(dx, dy)),
				insidePlayer: rect.width * rect.height > 0
					&& labelRect.left >= rect.left - 8 && labelRect.right <= rect.right + 8
					&& labelRect.top >= rect.top - 8 && labelRect.bottom <= rect.bottom + 8,
			};
		});
	}

	function reactChain(node, maxUp = 16) {
		let fiberKey = null;
		try {
			fiberKey = Object.keys(node).find((key) => FIBER_KEY.test(key)) ?? null;
		} catch {
			fiberKey = null;
		}
		if (!fiberKey) return null;
		const chain = [];
		let fiber = safeGet(node, fiberKey);
		for (let depth = 0; fiber && depth < maxUp; depth += 1) {
			const type = fiber.type ?? fiber.elementType;
			const component = typeof type === "function"
				? type.displayName || type.name || "anonymous"
				: typeof type === "string"
					? type
					: null;
			const speedProps = [];
			const props = fiber.memoizedProps;
			if (props && typeof props === "object") {
				let inspected = 0;
				for (const key of Object.keys(props)) {
					if (inspected >= 64) break;
					inspected += 1;
					if (!SPEED_NAME.test(key)) continue;
					const value = safeGet(props, key);
					if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
						speedProps.push({ key, value });
					} else if (isObjectLike(value)) {
						speedProps.push({ key, value: describeValue(value) });
					}
				}
			}
			chain.push({
				depth,
				component,
				hasState: fiber.memoizedState != null,
				speedProps,
			});
			fiber = fiber.return;
		}
		return { fiberKey, chain };
	}

	// ---------------------------------------------------------------- T3 opt-in write

	function settersOf(candidates) {
		const setters = [];
		const seen = new Set();
		for (const candidate of candidates) {
			for (const entry of candidate.speedSurface) {
				if (entry.kind !== "setter" || (entry.arity !== 0 && entry.arity !== 1)) continue;
				const key = `${candidate.controllerName}.${entry.name}`;
				if (seen.has(key)) continue;
				seen.add(key);
				setters.push({
					key,
					name: entry.name,
					controllerName: candidate.controllerName,
					ancestorDepth: candidate.ancestorDepth,
					invoke(value) {
						const method = safeGet(candidate.controller, entry.name);
						if (typeof method !== "function") throw new Error(`${entry.name} is no longer callable`);
						return Reflect.apply(method, candidate.controller, entry.arity === 0 ? [] : [value]);
					},
				});
			}
		}
		return setters;
	}

	function waitFor(predicate, timeoutMs) {
		const started = performance.now();
		return new Promise((resolve) => {
			const tick = () => {
				let done = false;
				try {
					done = predicate();
				} catch {
					done = false;
				}
				if (done || performance.now() - started >= timeoutMs) {
					resolve(done);
					return;
				}
				setTimeout(tick, 60);
			};
			tick();
		});
	}

	function readLabelTexts(labels) {
		return labels.map((label) => label.anchor.textContent?.trim() ?? "");
	}

	async function attempt(candidate, element, desired, settleMs) {
		const beforeRate = element.playbackRate;
		const beforeLabels = readLabelTexts(labelSnapshot());
		const result = {
			target: candidate.key,
			desired,
			rateAfter: null,
			changedRate: false,
			labelsBefore: beforeLabels,
			labelsAfter: null,
			changedLabel: false,
			restored: false,
			error: null,
			restoreError: null,
		};
		try {
			await candidate.invoke(desired);
			await waitFor(
				() => Math.abs(element.playbackRate - desired) <= SPEED_TOLERANCE
					|| readLabelTexts(labelSnapshot()).join("|") !== beforeLabels.join("|"),
				settleMs,
			);
			result.rateAfter = element.playbackRate;
			result.changedRate = Math.abs(element.playbackRate - desired) <= SPEED_TOLERANCE;
			result.labelsAfter = readLabelTexts(labelSnapshot());
			result.changedLabel = result.labelsAfter.join("|") !== beforeLabels.join("|");
		} catch (caught) {
			result.error = caught instanceof Error ? caught.message : String(caught);
		} finally {
			try {
				await candidate.invoke(beforeRate);
			} catch (caught) {
				// The DOM restore below is the fallback; keep the setter failure as
				// evidence instead of hiding it.
				result.restoreError = caught instanceof Error ? caught.message : String(caught);
			}
			try {
				element.playbackRate = beforeRate;
			} catch (caught) {
				const message = caught instanceof Error ? caught.message : String(caught);
				result.restoreError = result.restoreError ? `${result.restoreError}; ${message}` : message;
			}
			await waitFor(() => Math.abs(element.playbackRate - beforeRate) <= SPEED_TOLERANCE, 600);
			result.restored = Math.abs(element.playbackRate - beforeRate) <= SPEED_TOLERANCE;
		}
		return result;
	}

	// ---------------------------------------------------------------- orchestration

	let lastReport = null;
	let lastState = null;

	function verdictOf(report) {
		if (report.bridge.speed.supported) {
			return {
				code: "bridge-ok",
				detail: "The shipped bridge already resolves a speed controller; the drift is upstream of discovery.",
			};
		}
		if (report.discovery.nearMisses.length > 0) {
			return {
				code: "discovery-gap",
				detail: "A speed-capable controller exists but the bridge whitelist rejects it.",
			};
		}
		if (report.projection.labels.length > 0) {
			return {
				code: "unreachable-controller",
				detail: "The label is taggable but no speed surface is reachable from the media element.",
			};
		}
		return {
			code: "inconclusive",
			detail: "No speed controller and no label; confirm the player is mounted and playing.",
		};
	}

	function buildReport(options) {
		const media = listMedia();
		const target = media[0]?.element ?? null;
		if (!target) throw new Error("No <video>/<audio> found on this page");
		const bridge = {
			speed: bridgeProbe(target, "speed"),
			volumeBase: bridgeProbe(target, "volumeBase"),
			mediaMuted: bridgeProbe(target, "mediaMuted"),
		};
		const candidates = collectCandidates(target);
		const discovery = summarizeDiscovery(candidates);
		const labels = labelDistances(labelSnapshot(), target);
		const projection = {
			labels: labels
				.map(({ anchor, ...rest }) => rest)
				.sort((left, right) => Number(right.insidePlayer) - Number(left.insidePlayer) || left.distancePx - right.distancePx),
			react: reactChain(target),
		};
		const report = {
			probe: {
				version: VERSION,
				at: new Date().toISOString(),
				url: location.href,
				host: location.hostname,
				options,
			},
			media: media
				.slice(0, 5)
				.map(({ element, ...rest }) => ({ ...rest, mediaElement: element.tagName.toLowerCase() })),
			bridge,
			discovery: {
				limits: { ...BRIDGE_LIMITS, probe: options },
				candidateCount: candidates.length,
				...discovery,
			},
			projection,
		};
		report.verdict = verdictOf(report);
		report.discovery.candidates = candidates.map((candidate) => ({
			controller: candidate.controllerName,
			ancestorDepth: candidate.ancestorDepth,
			propertyName: candidate.propertyName,
			propertyIndex: candidate.propertyIndex,
			associationKind: candidate.associationKind,
			associationKey: candidate.associationKey,
			acceptedByBridge: candidate.accepted,
			rejectionReasons: candidate.reasons,
			speedSurface: candidate.speedSurface,
		}));
		lastState = { element: target, candidates, labels, setters: settersOf(candidates) };
		return report;
	}

	function printSummary(report) {
		const line = (label, value) => console.log(`%c${label}`, "color:#888", value);
		console.log(
			`%cSPECTRA Douyin speed probe v${report.probe.version}`,
			"font-weight:bold;font-size:13px",
			report.probe.host,
		);
		line(
			"T0 bridge(speed)",
			`supported=${report.bridge.speed.supported} installed=${report.bridge.speed.installed} adapter=${report.bridge.speed.adapterId ?? "none"}`,
		);
		line(
			"T1 discovery",
			`candidates=${report.discovery.candidateCount} nearMiss=${report.discovery.nearMisses.length}`,
		);
		if (Object.keys(report.discovery.reasonCounts).length > 0) {
			console.table(report.discovery.reasonCounts);
		}
		if (report.discovery.nearMisses.length > 0) console.table(report.discovery.nearMisses);
		line("T2 projection", `labels=${report.projection.labels.length}`);
		if (report.projection.labels.length > 0) {
			console.table(report.projection.labels.slice(0, 6).map(({ path, text, value, distancePx, insidePlayer }) => ({
				text,
				value,
				distancePx,
				insidePlayer,
				path,
			})));
		}
		line("verdict", `${report.verdict.code} — ${report.verdict.detail}`);
		line("next", "call __SPECTRA_DOUYIN_PROBE__.tryWrite() to test setters, then .copy()");
	}

	function run(options = READ_ONLY_OPTIONS) {
		const merged = { ...READ_ONLY_OPTIONS, ...options };
		const report = buildReport(merged);
		lastReport = report;
		printSummary(report);
		return report;
	}

	async function tryWrite(options = {}) {
		if (!lastState) run();
		const settings = { desired: 1.5, settleMs: 1200, only: null, includeDom: true, ...options };
		const { element, setters } = lastState;
		const beforeRate = element.playbackRate;
		const attempts = [];
		console.log(
			`%cT3 write probe%c ensuring the player is paused; every attempt restores ${beforeRate}`,
			"font-weight:bold",
			"color:#888",
		);
		if (settings.includeDom) {
			attempts.push(
				await attempt(
					{
						key: "HTMLMediaElement.playbackRate (dom-native control)",
						invoke(value) {
							element.playbackRate = value;
						},
					},
					element,
					settings.desired,
					settings.settleMs,
				),
			);
		}
		for (const setter of setters.slice(0, MAX_SETTER_ATTEMPTS)) {
			if (settings.only && setter.name !== settings.only) continue;
			attempts.push(await attempt(setter, element, settings.desired, settings.settleMs));
			if (attempts[attempts.length - 1].changedLabel) break;
		}
		const winner = attempts.find((entry) => entry.changedLabel && entry.changedRate);
		const domControl = attempts.find((entry) => entry.target.includes("dom-native"));
		const result = {
			at: new Date().toISOString(),
			desired: settings.desired,
			attempts,
			uiDrivingSetter: winner?.target ?? null,
			domWriteMovesLabel: domControl?.changedLabel ?? null,
			allRestored: attempts.every((entry) => entry.restored),
		};
		console.table(
			attempts.map(({ target, changedRate, changedLabel, restored, error }) => ({
				target,
				changedRate,
				changedLabel,
				restored,
				error,
			})),
		);
		console.log("%cT3 result", "font-weight:bold", result);
		if (lastReport) lastReport.write = result;
		return result;
	}

	function copy() {
		const text = JSON.stringify(lastReport, null, 2);
		if (!navigator.clipboard?.writeText) {
			console.log(text);
			return Promise.resolve(false);
		}
		return navigator.clipboard.writeText(text).then(
			() => {
				console.log("%creport copied", "color:#2a7");
				return true;
			},
			() => {
				console.log(text);
				return false;
			},
		);
	}

	function help() {
		console.log(`%cSPECTRA Douyin speed probe v${VERSION}`, "font-weight:bold;font-size:13px");
		console.log([
			"run()                  read-only: T0 bridge verdict, T1 discovery attribution, T2 label mapping",
			"tryWrite({desired})    opt-in: DOM control first, then candidate setters; restores the prior rate",
			"tryWrite({only:'setSpeed'})  restrict to one setter name",
			"copy()                 copy the last report JSON for the runbook",
			"report                 last report object",
			"",
			"Order of evidence: pause the video first; run(); then tryWrite(); then copy().",
		].join("\n"));
		return lastReport;
	}

	window.__SPECTRA_DOUYIN_PROBE__ = {
		version: VERSION,
		run,
		tryWrite,
		copy,
		help,
		get report() {
			return lastReport;
		},
	};
	console.log(
		`%cSPECTRA Douyin probe v${VERSION} loaded%c — __SPECTRA_DOUYIN_PROBE__.help()`,
		"font-weight:bold;color:#2a7",
		"color:#888",
	);
})();
