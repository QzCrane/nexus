// goal: run the shipped Douyin speed probe against a live douyin.com tab, with the real extension loaded
// inv: the probe's T0 answer only means something when the shipped bridge is actually installed in the page

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../..");
const probeSource = readFileSync(resolve(here, "douyin-speed-probe.js"), "utf8");
const extensionDir = resolve(appDir, "dist");
const evidenceDir = resolve(appDir, "../../docs/research/evidence");

interface ProbeReport {
	probe: { version: string; at: string; url: string; host: string };
	media: { score: number; playbackRate: number; duration: number | null; hasSource: boolean; mediaElement: string }[];
	bridge: {
		speed: { supported: boolean; installed: boolean; actual: number | null; adapterId: string | null; error: string | null };
		volumeBase: { supported: boolean; installed: boolean };
		mediaMuted: { supported: boolean; installed: boolean };
	};
	discovery: {
		candidateCount: number;
		nearMisses: { controller: string; rejectionReasons: string[]; speedNames: string[]; associationKey: string | null }[];
		reasonCounts: Record<string, number>;
		candidates: {
			controller: string;
			ancestorDepth: number;
			propertyName: string;
			propertyIndex: number;
			associationKey: string | null;
			acceptedByBridge: boolean;
			rejectionReasons: string[];
			speedSurface: { setterNames: string[]; getterNames: string[]; accessorNames: string[] };
		}[];
	};
	projection: {
		labels: { text: string; value: number; distancePx: number; insidePlayer: boolean; path: string }[];
		react: { fiberKey: string; chain: { component: string | null; speedProps?: string[] }[] } | null;
	};
	verdict: { code: string; detail: string };
}

interface WriteReport {
	attempts: {
		target: string;
		changedRate: boolean;
		changedLabel: boolean;
		restored: boolean;
		error: string | null;
	}[];
	uiDrivingSetter: string | null;
	domWriteMovesLabel: boolean | null;
	allRestored: boolean;
}

const target = process.argv.find((a) => a.startsWith("--url="))?.slice(6) ?? "";
const writeArg = process.argv.find((a) => a.startsWith("--write="))?.slice(8);
const desired = writeArg === undefined ? null : Number(writeArg);
// Puppeteer's pinned download is not installed here; use the browser the user
// actually runs, like the other live probes do.
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH
	|| "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await puppeteer.launch({
	headless: false,
	enableExtensions: true,
	executablePath: CHROME_PATH,
	args: [
		"--no-sandbox",
		"--disable-dev-shm-usage",
		"--mute-audio",
		"--disable-blink-features=AutomationControlled",
		"--autoplay-policy=no-user-gesture-required",
		"--lang=zh-CN",
	],
	defaultViewport: { width: 1440, height: 900 },
});
// Chrome no longer honours --load-extension; install the packed directory
// through the debugging protocol so the bridge under test is really there.
{
	const session = await browser.target().createCDPSession();
	await session.send("Extensions.loadUnpacked", { path: extensionDir }).catch((error: unknown) => {
		throw new Error(`could not load ${extensionDir}: ${String(error)}`);
	});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
	await browser.waitForTarget((t) => t.type() === "service_worker", { timeout: 20000 }).catch(() => null);
	const page = await browser.newPage();

	let url = target;
	if (!url) {
		await page.goto("https://www.douyin.com/jingxuan", { waitUntil: "domcontentloaded", timeout: 60000 });
		await sleep(9000);
		const id = await page.evaluate(() => document.documentElement.innerHTML.match(/\/video\/(\d{15,25})/)?.[1] ?? "");
		if (!id) throw new Error("could not discover an aweme id");
		url = `https://www.douyin.com/video/${id}`;
	}
	console.log("url:", url);

	await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
	await sleep(12000);

	await page.evaluate(probeSource);
	const report = (await page.evaluate(() => {
		const api = (window as unknown as { __SPECTRA_DOUYIN_PROBE__?: { run: () => ProbeReport } }).__SPECTRA_DOUYIN_PROBE__;
		if (!api) throw new Error("probe api missing");
		return api.run();
	})) as ProbeReport;

	const write = desired === null
		? null
		: (await page.evaluate(async (rate: number) => {
			const api = (window as unknown as { __SPECTRA_DOUYIN_PROBE__?: { tryWrite: (o: { desired: number }) => Promise<WriteReport> } }).__SPECTRA_DOUYIN_PROBE__;
			if (!api) throw new Error("probe api missing");
			return api.tryWrite({ desired: rate });
		}, desired)) as WriteReport;

	const evidence = { capturedAt: new Date().toISOString(), url, report, write };
	mkdirSync(evidenceDir, { recursive: true });
	const file = resolve(evidenceDir, "2026-11-01-douyin-speed-probe.json");
	writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

	console.log("\n=== T0 ===");
	console.log(JSON.stringify(report.bridge.speed, null, 2));
	console.log("\n=== media ===");
	console.log(JSON.stringify(report.media, null, 2));
	console.log("\n=== discovery ===");
	console.log(
		JSON.stringify(
			{
				candidateCount: report.discovery.candidateCount,
				reasonCounts: report.discovery.reasonCounts,
				nearMisses: report.discovery.nearMisses.slice(0, 8),
				candidates: report.discovery.candidates.slice(0, 8),
			},
			null,
			2,
		),
	);
	console.log("\n=== projection ===");
	console.log(JSON.stringify({ labels: report.projection.labels.slice(0, 8), react: report.projection.react }, null, 2));
	console.log("\n=== verdict ===");
	console.log(JSON.stringify(report.verdict, null, 2));
	if (write !== null) {
		console.log("\n=== write ===");
		console.log(JSON.stringify(write, null, 2));
	}
	console.log("\nevidence:", file);
} finally {
	await browser.close();
}
