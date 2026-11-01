// goal: prove the declared adapter actually fixes the one-way sync on a page the
// generic bridge cannot reach, using the real shipped MAIN bundle
// inv: the decoy model fails, so a passing run means declared knowledge — not a
// wider heuristic — produced the result

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer, { type Page } from "puppeteer";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../..");
const fixturePath = resolve(here, "fixtures/declared-adapter-player.html");
const bridgePath = resolve(appDir, "dist/content-page-media-bridge.js");

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ""): void {
	results.push({ name, ok, detail });
}

function fail(message: string): never {
	console.error(`declared adapter verification failed: ${message}`);
	process.exit(1);
}

if (!existsSync(bridgePath)) fail(`missing ${bridgePath}; run "bun build.ts --dev" first`);
if (!existsSync(fixturePath)) fail(`missing ${fixturePath}`);

const bridgeSource = readFileSync(bridgePath, "utf8");
const fixtureHtml = readFileSync(fixturePath, "utf8");

const DOUYIN_ORIGIN = "https://www.douyin.com";
const CONTROL_ORIGIN = "https://example.test";

interface BridgeResult {
	requestId?: string;
	field?: string;
	supported?: boolean;
	actual?: number | boolean | null;
	error?: string;
	adapterId?: string;
	projection?: number | boolean | null;
}

async function openPage(
	browser: Awaited<ReturnType<typeof puppeteer.launch>>,
	origin: string,
	mode: string,
): Promise<Page> {
	const page = await browser.newPage();
	await page.setRequestInterception(true);
	page.on("request", (request) => {
		if (request.url().startsWith(`${origin}/`)) {
			void request.respond({
				status: 200,
				contentType: "text/html; charset=utf-8",
				body: fixtureHtml,
			});
			return;
		}
		void request.continue();
	});
	await page.goto(`${origin}/video/1?mode=${mode}`, { waitUntil: "load" });
	await page.addScriptTag({ content: bridgeSource });
	return page;
}

async function call(
	page: Page,
	operation: "read" | "write" | "probe",
	field: string,
	value?: number,
): Promise<BridgeResult> {
	return page.evaluate((args) => {
		const element = document.querySelector("video");
		if (!(element instanceof HTMLVideoElement)) throw new Error("fixture video is missing");
		const requestId = crypto.randomUUID();
		const payload: Record<string, unknown> = { requestId, operation: args.operation, field: args.field };
		if (args.value !== undefined) payload.value = args.value;
		element.setAttribute("data-spectra-page-media-request-v2", JSON.stringify(payload));
		element.dispatchEvent(new Event("spectra:page-media:v2", { composed: true }));
		const encoded = element.getAttribute("data-spectra-page-media-result-v2");
		element.removeAttribute("data-spectra-page-media-request-v2");
		element.removeAttribute("data-spectra-page-media-result-v2");
		return encoded ? JSON.parse(encoded) : { supported: false };
	}, { operation, field, value });
}

async function probeState(page: Page): Promise<{
	mode: string;
	speed: number;
	badge: string;
	rate: number;
	decoyWrites: number;
}> {
	return page.evaluate(() => {
		const fixture = (window as unknown as {
			__fixture: {
				mode: string;
				speed: () => number;
				badge: () => string;
				rate: () => number;
				decoyWrites: () => number;
			};
		}).__fixture;
		return {
			mode: fixture.mode,
			speed: fixture.speed(),
			badge: fixture.badge(),
			rate: fixture.rate(),
			decoyWrites: fixture.decoyWrites(),
		};
	});
}

const browser = await puppeteer.launch({
	headless: true,
	args: ["--no-sandbox", "--disable-dev-shm-usage", "--mute-audio"],
});

try {
	// --- declared host: the adapter must reach the controller generic discovery
	// misses, and must outrank the decoy that generic discovery would pick.
	const declared = await openPage(browser, DOUYIN_ORIGIN, "declared");

	const probe = await call(declared, "probe", "speed");
	check("probe reports a declared capability", probe.supported === true, JSON.stringify(probe));
	check(
		"probe names the adapter that answered",
		probe.adapterId === "douyin-speed",
		`adapterId=${String(probe.adapterId)}`,
	);

	const baseline = await call(declared, "read", "speed");
	check("baseline reads the controller getter", baseline.actual === 1, `actual=${String(baseline.actual)}`);
	check(
		"baseline reads the badge as the projection",
		baseline.projection === 1,
		`projection=${String(baseline.projection)}`,
	);

	const written = await call(declared, "write", "speed", 1.5);
	const afterWrite = await probeState(declared);
	check("write is accepted", written.supported === true && !written.error, JSON.stringify(written.error ?? ""));
	check("write reports the controller value", written.actual === 1.5, `actual=${String(written.actual)}`);
	check("write reports the badge", written.projection === 1.5, `projection=${String(written.projection)}`);
	check("the media element follows", afterWrite.rate === 1.5, `rate=${afterWrite.rate}`);
	check("the badge follows", afterWrite.badge === "1.5x", `badge=${afterWrite.badge}`);
	check(
		"the decoy setter is never used",
		afterWrite.decoyWrites === 0,
		`decoyWrites=${afterWrite.decoyWrites}`,
	);

	const restore = await call(declared, "write", "speed", 1);
	const afterRestore = await probeState(declared);
	check(
		"the declared writer restores the baseline",
		restore.actual === 1 && afterRestore.badge === "1.0x",
		`actual=${String(restore.actual)} badge=${afterRestore.badge}`,
	);

	// --- renamed revision: every string the row declares is renamed on the page.
	// This exercises all five fallback paths at once — the plugin key, the config
	// field, the setter method, the selected class, and the panel class — so the
	// steady-state adapter must still discover, read, and write through the row
	// instead of degrading to the rate-correct-but-UI-blind proxy.
	const renamed = await openPage(browser, DOUYIN_ORIGIN, "renamed");
	const renamedProbe = await call(renamed, "probe", "speed");
	check("renamed revision is still discovered", renamedProbe.supported === true, JSON.stringify(renamedProbe));
	check(
		"renamed revision still names the adapter",
		renamedProbe.adapterId === "douyin-speed",
		`adapterId=${String(renamedProbe.adapterId)}`,
	);
	const renamedRead = await call(renamed, "read", "speed");
	check(
		"renamed revision reads the badge via fallback field",
		renamedRead.projection === 1,
		`projection=${String(renamedRead.projection)}`,
	);
	const renamedWrite = await call(renamed, "write", "speed", 2);
	const afterRenamed = await probeState(renamed);
	check("renamed write is accepted", renamedWrite.supported === true && !renamedWrite.error, JSON.stringify(renamedWrite.error ?? ""));
	check("renamed write reports the controller value", renamedWrite.actual === 2, `actual=${String(renamedWrite.actual)}`);
	check("renamed write reports the badge", renamedWrite.projection === 2, `projection=${String(renamedWrite.projection)}`);
	check("renamed media element follows", afterRenamed.rate === 2, `rate=${afterRenamed.rate}`);
	check("renamed badge follows via fallback marker", afterRenamed.badge === "2.0x", `badge=${afterRenamed.badge}`);
	check(
		"renamed decoy setter is never used",
		afterRenamed.decoyWrites === 0,
		`decoyWrites=${afterRenamed.decoyWrites}`,
	);
	const renamedReset = await call(renamed, "write", "speed", 1);
	const afterRenamedReset = await probeState(renamed);
	check(
		"renamed writer restores the baseline",
		renamedReset.actual === 1 && afterRenamedReset.badge === "1.0x",
		`actual=${String(renamedReset.actual)} badge=${afterRenamedReset.badge}`,
	);

	// --- stale host: the setter moves the rate but the plugin's rendered state
	// never follows. The declared read path is what makes this visible, and the
	// bridge must refuse rather than leave a rate its own UI denies.
	const stale = await openPage(browser, DOUYIN_ORIGIN, "stale");
	const staleProbe = await call(stale, "probe", "speed");
	check("stale player is still discovered", staleProbe.supported === true, JSON.stringify(staleProbe));
	const staleWrite = await call(stale, "write", "speed", 1.75);
	const staleState = await probeState(stale);
	check(
		"a write the rendered state cannot confirm is refused",
		staleWrite.actual === null && typeof staleWrite.error === "string",
		JSON.stringify(staleWrite),
	);
	check(
		"the refused write is rolled back on the media element",
		staleState.rate === 1,
		`rate=${staleState.rate}`,
	);
	check("stale badge never claimed the new rate", staleState.badge === "1.0x", `badge=${staleState.badge}`);

	// --- control host: no declared row, and the generic bridge cannot see the
	// controller, so the answer must stay unsupported. This is what keeps the
	// adapter from being mistaken for a general heuristic widening.
	const control = await openPage(browser, CONTROL_ORIGIN, "bare");
	const controlProbe = await call(control, "probe", "speed");
	check(
		"a page with no discoverable controller stays unsupported",
		controlProbe.supported === false,
		JSON.stringify(controlProbe),
	);
	check(
		"a host without a row names no adapter",
		controlProbe.adapterId === undefined,
		`adapterId=${String(controlProbe.adapterId)}`,
	);

	// Same page shape on a host with no row: the generic controller is still
	// found, but no projection channel may appear. This is what keeps the
	// witness gated on the row rather than on the field.
	const generic = await openPage(browser, CONTROL_ORIGIN, "declared");
	const genericProbe = await call(generic, "probe", "speed");
	check(
		"generic discovery still answers without a row",
		genericProbe.supported === true,
		JSON.stringify(genericProbe),
	);
	const genericRead = await call(generic, "read", "speed");
	check(
		"no row means no projection channel",
		genericRead.projection === undefined,
		`projection=${String(genericRead.projection)}`,
	);
	check(
		"no row means no adapter attribution",
		genericRead.adapterId === undefined,
		`adapterId=${String(genericRead.adapterId)}`,
	);
} finally {
	await browser.close();
}

const failed = results.filter((entry) => !entry.ok);
for (const entry of results) {
	console.log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.name}${entry.detail ? `  (${entry.detail})` : ""}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exit(1);
