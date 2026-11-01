// goal: prove end-to-end on a live douyin.com tab that the shipped bridge — not
// a manual console call — moves both the playback rate and the panel's selection
// inv: the panel only renders its list behind login, so the run opens the same
// branch in memory first; a DOM-only write must leave the selection behind

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Page } from "puppeteer";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../..");
const extensionDir = resolve(appDir, "dist");
const evidenceDir = resolve(appDir, "../../docs/research/evidence");

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ""): void {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PanelState {
	videoRate: number;
	playbackRate: number | null;
	playBackRatio: number | null;
	selected: string;
	hasList: boolean;
}

async function panelState(page: Page): Promise<PanelState> {
	return page.evaluate(() => {
		const player = (window as unknown as {
			player?: { playbackRate?: number; plugins?: Record<string, { config?: { playBackRatio?: number }; root?: HTMLElement }> };
		}).player;
		const plugin = player?.plugins?.playbacksettingplugin;
		const selected = plugin?.root?.querySelector(".xgplayer-playratio-item.select")?.textContent ?? "";
		return {
			videoRate: (document.querySelector("video") as HTMLVideoElement | null)?.playbackRate ?? -1,
			playbackRate: typeof player?.playbackRate === "number" ? player.playbackRate : null,
			playBackRatio: typeof plugin?.config?.playBackRatio === "number" ? plugin.config.playBackRatio : null,
			selected: selected.trim(),
			hasList: (plugin?.root?.querySelectorAll(".xgplayer-playratio-item").length ?? 0) > 0,
		};
	});
}

interface BridgeResult {
	supported?: boolean;
	actual?: number | null;
	projection?: number | null;
	adapterId?: string;
	error?: string;
}

async function bridge(page: Page, operation: "probe" | "read" | "write", value?: number): Promise<BridgeResult> {
	return page.evaluate((args) => {
		const element = document.querySelector("video");
		if (!(element instanceof HTMLVideoElement)) throw new Error("no video element");
		const requestId = crypto.randomUUID();
		const payload: Record<string, unknown> = { requestId, operation: args.operation, field: "speed" };
		if (args.value !== undefined) payload.value = args.value;
		element.setAttribute("data-spectra-page-media-request-v2", JSON.stringify(payload));
		element.removeAttribute("data-spectra-page-media-result-v2");
		element.dispatchEvent(new Event("spectra:page-media:v2", { bubbles: true, composed: true }));
		const encoded = element.getAttribute("data-spectra-page-media-result-v2");
		element.removeAttribute("data-spectra-page-media-request-v2");
		element.removeAttribute("data-spectra-page-media-result-v2");
		return encoded ? JSON.parse(encoded) : { supported: false, error: "no result" };
	}, { operation, value });
}

/** Surface the logged-in branch of the site's own component. Memory only. */
async function openPanel(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const plugin = (window as unknown as {
			player?: { plugins?: Record<string, { updateConfig?: (c: Record<string, unknown>) => void; root?: HTMLElement }> };
		}).player?.plugins?.playbacksettingplugin;
		if (!plugin?.updateConfig) return false;
		try {
			plugin.updateConfig({ loginBlock: false });
			return true;
		} catch {
			return false;
		}
	});
}

async function closePanel(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const plugin = (window as unknown as {
			player?: { plugins?: Record<string, { updateConfig?: (c: Record<string, unknown>) => void }> };
		}).player?.plugins?.playbacksettingplugin;
		if (!plugin?.updateConfig) return false;
		try {
			plugin.updateConfig({ loginBlock: true });
			return true;
		} catch {
			return false;
		}
	});
}

const browser = await puppeteer.launch({
	headless: false,
	enableExtensions: true,
	args: [
		"--no-sandbox",
		"--disable-dev-shm-usage",
		"--mute-audio",
		"--disable-blink-features=AutomationControlled",
		"--autoplay-policy=no-user-gesture-required",
		"--lang=zh-CN",
		`--disable-extensions-except=${extensionDir}`,
		`--load-extension=${extensionDir}`,
	],
	defaultViewport: { width: 1440, height: 900 },
});

try {
	await browser.waitForTarget((t) => t.type() === "service_worker", { timeout: 20000 }).catch(() => null);
	const page = await browser.newPage();

	let awemeId = "";
	try {
		awemeId = readFileSync(resolve(here, "_aweme-id.txt"), "utf8").trim();
	} catch {
		awemeId = "";
	}
	if (awemeId.length < 15) {
		await page.goto("https://www.douyin.com/jingxuan", { waitUntil: "domcontentloaded", timeout: 60000 });
		await sleep(9000);
		awemeId = await page.evaluate(() => document.documentElement.innerHTML.match(/\/video\/(\d{15,25})/)?.[1] ?? "");
	}
	if (awemeId.length < 15) throw new Error("could not resolve a live video id");

	const url = `https://www.douyin.com/video/${awemeId}`;
	console.log(`url: ${url}`);
	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
	await sleep(12000);

	const probe = await bridge(page, "probe");
	check("the shipped bridge answers the live page", probe.supported === true, JSON.stringify(probe));
	check("the answer is attributed to the declared row", probe.adapterId === "douyin-speed", `adapterId=${String(probe.adapterId)}`);

	const opened = await openPanel(page);
	check("the site's speed list can be surfaced for observation", opened, `opened=${opened}`);
	await sleep(600);

	const baseline = await panelState(page);
	check("the baseline selection is the site's current rate", baseline.hasList && baseline.selected === "1.0x", JSON.stringify(baseline));

	// A. rate-only write: the exact shape of the reported bug.
	await page.evaluate(() => {
		const video = document.querySelector("video");
		if (video instanceof HTMLVideoElement) video.playbackRate = 1.5;
	});
	await sleep(500);
	const afterDom = await panelState(page);
	check("a DOM-only write moves the media element", afterDom.videoRate === 1.5, `videoRate=${afterDom.videoRate}`);
	check(
		"a DOM-only write leaves the panel behind",
		afterDom.selected === "1.0x" && afterDom.playBackRatio === 1,
		JSON.stringify(afterDom),
	);

	await page.evaluate(() => {
		const video = document.querySelector("video");
		if (video instanceof HTMLVideoElement) video.playbackRate = 1;
	});
	await sleep(400);

	// B. the shipped bridge write: the adapter's declared path.
	const written = await bridge(page, "write", 1.5);
	await sleep(600);
	const afterBridge = await panelState(page);
	check("the bridge accepts the write", written.error === undefined && written.actual === 1.5, JSON.stringify(written));
	check("the bridge reports the rate it moved", afterBridge.videoRate === 1.5, `videoRate=${afterBridge.videoRate}`);
	check("the panel selection follows the bridge", afterBridge.selected === "1.5x", JSON.stringify(afterBridge));
	check(
		"the rendered state agrees with the controller",
		afterBridge.playBackRatio === 1.5,
		`playBackRatio=${String(afterBridge.playBackRatio)}`,
	);

	// The site re-renders the panel through React, so the projection is not
	// readable in the same task as the write. That is why the executor audits by
	// polling instead of trusting the write's own snapshot.
	const settled = await bridge(page, "read");
	check(
		"the projection becomes readable once React has rendered",
		settled.projection === 1.5,
		JSON.stringify(settled),
	);

	// restore through the same declared path
	const restored = await bridge(page, "write", 1);
	await sleep(500);
	const afterRestore = await panelState(page);
	check("the bridge restores the baseline", restored.actual === 1 && afterRestore.selected === "1.0x", JSON.stringify(afterRestore));

	await closePanel(page);

	const evidence = {
		capturedAt: new Date().toISOString(),
		url,
		surface:
			"anonymous douyin.com video page; the speed list only renders behind login, so the run calls the site plugin's own updateConfig({loginBlock:false}) in memory to observe the logged-in branch, then restores it",
		probe,
		steps: { baseline, afterDom, written, afterBridge, afterRestore },
		checks: results,
		passed: results.filter((r) => r.ok).length,
		total: results.length,
	};
	mkdirSync(evidenceDir, { recursive: true });
	const file = resolve(evidenceDir, "2026-11-01-douyin-speed-live.json");
	writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
	console.log(`\nevidence: ${file}`);
} finally {
	await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
