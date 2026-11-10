// goal: prove the Douyin speed probe attributes the real failure shape before it is trusted on a live tab
// inv: the fixture models a state-driven badge; a passing run falsifies "the bridge is broken" and confirms "coverage is narrow"

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer";

interface ProbeReport {
	bridge: { speed: { supported: boolean; installed: boolean }; volumeBase: { supported: boolean } };
	discovery: {
		nearMisses: { controller: string; rejectionReasons: string[]; speedNames: string[] }[];
		reasonCounts: Record<string, number>;
		candidateCount: number;
	};
	projection: {
		labels: { text: string; value: number; insidePlayer: boolean; path: string }[];
		react: { fiberKey: string; chain: { component: string | null }[] } | null;
	};
	verdict: { code: string; detail: string };
}

interface WriteResult {
	attempts: { target: string; changedRate: boolean; changedLabel: boolean; restored: boolean; error: string | null }[];
	uiDrivingSetter: string | null;
	domWriteMovesLabel: boolean | null;
	allRestored: boolean;
}

interface ProbeApi {
	run: () => ProbeReport;
	tryWrite: (options?: { desired?: number; includeDom?: boolean }) => Promise<WriteResult>;
}

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../..");
const fixtureUrl = pathToFileURL(resolve(here, "fixtures/douyin-like-player.html")).href;
const bridgePath = resolve(appDir, "dist/content-page-media-bridge.js");
const probePath = resolve(here, "douyin-speed-probe.js");

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ""): void {
	results.push({ name, ok, detail });
}

function fail(message: string): never {
	console.error(`probe verification failed: ${message}`);
	process.exit(1);
}

if (!existsSync(bridgePath)) fail(`missing ${bridgePath}; run "bun build.ts --dev" first`);
if (!existsSync(probePath)) fail(`missing ${probePath}`);

const bridgeSource = readFileSync(bridgePath, "utf8");
const probeSource = readFileSync(probePath, "utf8");

const browser = await puppeteer.launch({
	headless: true,
	// Puppeteer's pinned download is not installed here; run the browser this
	// machine actually has, like the live probes do.
	executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
		|| "C:/Program Files/Google/Chrome/Application/chrome.exe",
	args: ["--no-sandbox", "--disable-dev-shm-usage", "--mute-audio"],
});

async function openFixture(mode: "douyin" | "legacy"): Promise<{
	page: Awaited<ReturnType<typeof browser.newPage>>;
	errors: string[];
	report: ProbeReport;
	write: WriteResult;
}> {
	const page = await browser.newPage();
	await page.setViewport({ width: 1200, height: 900 });
	const errors: string[] = [];
	page.on("pageerror", (error: Error) => errors.push(error.message));
	await page.goto(`${fixtureUrl}${mode === "legacy" ? "?mode=legacy" : ""}`, { waitUntil: "load" });
	await page.addScriptTag({ content: bridgeSource });
	await page.addScriptTag({ content: probeSource });
	const report = (await page.evaluate(() => {
		const probe = (window as unknown as { __SPECTRA_DOUYIN_PROBE__: ProbeApi }).__SPECTRA_DOUYIN_PROBE__;
		return probe.run();
	})) as ProbeReport;
	const write = (await page.evaluate(async () => {
		const probe = (window as unknown as { __SPECTRA_DOUYIN_PROBE__: ProbeApi }).__SPECTRA_DOUYIN_PROBE__;
		return probe.tryWrite({ desired: 1.5 });
	})) as WriteResult;
	return { page, errors, report, write };
}

try {
	const douyin = await openFixture("douyin");
	const report = douyin.report;
	const domControl = douyin.write.attempts.find((attempt) => attempt.target.includes("dom-native"));
	const stateAttempt = douyin.write.attempts.find((attempt) => attempt.target.includes("setSpeed"));

	check("bridge is present", report.bridge.speed.installed);
	check("bridge cannot see speed", report.bridge.speed.supported === false, JSON.stringify(report.bridge.speed));
	check(
		"probe finds near misses",
		report.discovery.nearMisses.length >= 4,
		`${report.discovery.nearMisses.length} near misses`,
	);
	for (const reason of ["setter-name", "association-key", "property-index", "ancestor-depth"]) {
		check(
			`rejection reason: ${reason}`,
			(report.discovery.reasonCounts[reason] ?? 0) >= 1,
			`${report.discovery.reasonCounts[reason] ?? 0} hit(s)`,
		);
	}
	check(
		"speed surface is named",
		report.discovery.nearMisses.some((miss) => miss.speedNames.some((name) => name.startsWith("setSpeed:"))),
		report.discovery.nearMisses.map((miss) => miss.speedNames.join(",")).join(" | "),
	);
	check(
		"label is mapped inside the player",
		report.projection.labels.some((label) => label.value === 1 && label.insidePlayer),
		report.projection.labels.map((label) => `${label.text}@${label.path}`).join(" | "),
	);
	check("react chain is readable", report.projection.react !== null && report.projection.react.chain.length >= 1);
	check("verdict is discovery-gap", report.verdict.code === "discovery-gap", report.verdict.detail);
	check(
		"dom-native control moves rate but not label",
		domControl?.changedRate === true && domControl.changedLabel === false,
		JSON.stringify(domControl),
	);
	check(
		"state-driven setter moves both",
		stateAttempt?.changedRate === true && stateAttempt.changedLabel === true,
		JSON.stringify(stateAttempt),
	);
	check("ui-driving setter is identified", (douyin.write.uiDrivingSetter ?? "").includes("setSpeed"), douyin.write.uiDrivingSetter ?? "none");
	check("every attempt restored the prior rate", douyin.write.allRestored);
	check("fixture reported no page errors", douyin.errors.length === 0, douyin.errors.join(" | "));

	const legacy = await openFixture("legacy");
	check("control page: bridge sees speed", legacy.report.bridge.speed.supported === true);
	check("control page: verdict is bridge-ok", legacy.report.verdict.code === "bridge-ok", legacy.report.verdict.detail);
	check("control page: no page errors", legacy.errors.length === 0, legacy.errors.join(" | "));

	for (const { name, ok, detail } of results) {
		console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
	}
	const failed = results.filter((entry) => !entry.ok);
	console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
	process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
	await browser.close();
}
