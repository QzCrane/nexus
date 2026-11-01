// goal: dump the CURRENT live Douyin player + speed-panel shape so the adapter
//       can be repaired precisely after a site-side change (no guessing)
// usage: DevTools console on a LIVE, LOGGED-IN douyin.com video tab that has the
//        SPECTRA extension active -> paste this whole file -> __DY_DIAG__.run()
//        then __DY_DIAG__.copy() and paste the JSON back
// inv: read-only. It does NOT mutate playback rate or the panel.
(() => {
	const VERSION = "1.0.0";
	const RATE_FIELD = /(playback|playbackrate|playbackratio|ratio|rate|speed)/i;
	const LABEL_RE = /(\d+(?:\.\d+)?)\s*(倍|[x×](?![a-zA-Z]))/;

	function safeGet(object, key) {
		try {
			return object[key];
		} catch {
			return undefined;
		}
	}

	// ---- T0: the shipped bridge's current verdict on this exact tab ----------
	function bridgeProbe() {
		const video = document.querySelector("video");
		if (!(video instanceof HTMLVideoElement)) return { installed: false, error: "no video element" };
		const REQ = "data-spectra-page-media-request-v2";
		const RES = "data-spectra-page-media-result-v2";
		const EV = "spectra:page-media:v2";
		const installed = Boolean(window.__SPECTRA_PAGE_MEDIA_BRIDGE_V2__);
		const requestId = `dy-diag-${Date.now().toString(36)}`;
		const out = { installed, supported: false, actual: null, adapterId: null, error: null };
		try {
			video.setAttribute(REQ, JSON.stringify({ requestId, operation: "probe", field: "speed" }));
			video.removeAttribute(RES);
			video.dispatchEvent(new Event(EV, { bubbles: true, composed: true }));
			const raw = video.getAttribute(RES);
			if (!raw) out.error = "no result: bridge listener absent";
			else {
				const p = JSON.parse(raw);
				out.supported = p.supported === true;
				out.actual = p.actual ?? null;
				out.adapterId = p.adapterId ?? null;
			}
		} catch (e) {
			out.error = e instanceof Error ? e.message : String(e);
		} finally {
			video.removeAttribute(REQ);
			video.removeAttribute(RES);
		}
		return out;
	}

	// ---- T1: window.player plugin keys + every rate-like numeric field --------
	function playerShape() {
		const player = safeGet(window, "player");
		if (!player || typeof player !== "object") return { present: false };
		const plugins = safeGet(player, "plugins");
		const pluginKeys = plugins && typeof plugins === "object" ? Object.keys(plugins) : [];
		const fields = [];
		const scan = (obj, base, depth) => {
			if (!obj || typeof obj !== "object" || depth > 3) return;
			let names;
			try {
				names = Object.getOwnPropertyNames(obj);
			} catch {
				return;
			}
			for (const name of names) {
				if (names.length > 400 && !RATE_FIELD.test(name)) continue;
				if (!RATE_FIELD.test(name)) continue;
				let v;
				try {
					v = obj[name];
				} catch {
					continue;
				}
				if (typeof v === "number" && Number.isFinite(v) && v >= 0.1 && v <= 16) {
					fields.push({ path: `${base}.${name}`, value: v });
				} else if (v && typeof v === "object") {
					scan(v, `${base}.${name}`, depth + 1);
				}
			}
		};
		scan(player, "player", 0);
		// surface setter method names that look like rate/ratio changers
		const setters = [];
		const collectSetters = (obj, base, depth) => {
			if (!obj || typeof obj !== "object" || depth > 3) return;
			let names;
			try {
				names = Object.getOwnPropertyNames(obj);
			} catch {
				return;
			}
			for (const name of names) {
				if (names.length > 400 && !RATE_FIELD.test(name)) continue;
				if (!/^(set|update|change|apply|select|choose|on)/i.test(name)) continue;
				if (!RATE_FIELD.test(name)) continue;
				const d = safeGet(Object.getOwnPropertyDescriptor(obj, name), "value");
				if (typeof d === "function") setters.push({ path: `${base}.${name}`, arity: d.length });
				else if (v_obj_has_speed(obj[name])) collectSetters(obj[name], `${base}.${name}`, depth + 1);
			}
		};
		const v_obj_has_speed = (o) => o && typeof o === "object" && Object.getOwnPropertyNames(o).some((n) => RATE_FIELD.test(n));
		collectSetters(player, "player", 0);
		return {
			present: true,
			constructor: (player?.constructor?.name) ?? "unknown",
			pluginKeys,
			rateFields: fields.slice(0, 30),
			rateSetters: setters.slice(0, 30),
		};
	}

	// ---- T2: the speed panel's current DOM shape + which item is selected ----
	function panelShape() {
		const video = document.querySelector("video");
		if (!(video instanceof HTMLVideoElement)) return { found: false };
		// candidate scope selectors, broad first
		const scopeSelectors = [
			".xgplayer-playback-setting",
			"[class*='playback-setting']",
			"[class*='playratio']",
			"[class*='playback-rate']",
			"[class*='speed']",
		];
		let scope = null;
		let usedSelector = null;
		for (const sel of scopeSelectors) {
			try {
				scope = video.closest(".xgplayer")?.querySelector(sel)
					?? document.querySelector(sel);
			} catch {
				scope = null;
			}
			if (scope) {
				usedSelector = sel;
				break;
			}
		}
		if (!scope) return { found: false, note: "no speed panel scope found with known selectors" };

		const items = [...scope.querySelectorAll("*")].filter((el) =>
			LABEL_RE.test((el.textContent ?? "").trim()),
		);
		const distinctItemClasses = [...new Set(items.map((el) => (typeof el.className === "string" ? el.className.trim() : "")).filter(Boolean))];
		const selected = items
			.map((el) => {
				const cls = typeof el.className === "string" ? el.className : "";
				const tokens = cls.toLowerCase().split(/\s+/);
				const isSelected =
					tokens.some((t) => /(select|active|current|on|choosed|checked|chosen)/.test(t))
					|| el.getAttribute("aria-selected") === "true"
					|| el.getAttribute("data-selected") === "true"
					|| el.dataset?.selected === "true";
				return {
					text: (el.textContent ?? "").trim().slice(0, 24),
					class: cls.slice(0, 48),
					selected: isSelected,
				};
			})
			.filter((it) => it.text.length > 0)
			.slice(0, 16);
		return {
			found: true,
			usedScopeSelector: usedSelector,
			scopeClass: typeof scope.className === "string" ? scope.className.trim().slice(0, 64) : "",
			scopeTag: scope.tagName.toLowerCase(),
			itemCount: items.length,
			distinctItemClasses: distinctItemClasses.slice(0, 20),
			selectedItems: selected.filter((it) => it.selected),
			sampleItems: selected,
		};
	}

	function run() {
		const report = {
			diagnostic: { version: VERSION, at: new Date().toISOString(), url: location.href, host: location.hostname },
			videoRate: (() => {
				const v = document.querySelector("video");
				return v instanceof HTMLVideoElement ? v.playbackRate : null;
			})(),
			bridge: bridgeProbe(),
			player: playerShape(),
			panel: panelShape(),
		};
		console.log(`%cDY_DIAG v${VERSION}`, "font-weight:bold;font-size:13px", report.diagnostic.host);
		console.log("videoRate:", report.videoRate);
		console.log("bridge:", report.bridge);
		console.log("player:", report.player);
		console.log("panel:", report.panel);
		console.log("%cnext%c __DY_DIAG__.copy() to copy the JSON", "font-weight:bold", "color:#888");
		window.__DY_DIAG_LAST__ = report;
		return report;
	}

	function copy() {
		const text = JSON.stringify(window.__DY_DIAG_LAST__ ?? run(), null, 2);
		if (!navigator.clipboard?.writeText) {
			console.log(text);
			return Promise.resolve(false);
		}
		return navigator.clipboard.writeText(text).then(
			() => {
				console.log("%ccopied", "color:#2a7");
				return true;
			},
			() => {
				console.log(text);
				return false;
			},
		);
	}

	window.__DY_DIAG__ = { version: VERSION, run, copy, get report() { return window.__DY_DIAG_LAST__; } };
	console.log("%cDY_DIAG loaded%c — __DY_DIAG__.run() then __DY_DIAG__.copy()", "font-weight:bold;color:#2a7", "color:#888");
})();
