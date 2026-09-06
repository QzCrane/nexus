import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(relativePath: string): string {
	return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const manifest = JSON.parse(source('public/manifest.json')) as {
	permissions?: string[];
	optional_permissions?: string[];
};
const policy = JSON.parse(source('permission-policy.json')) as {
	permissions: Record<string, { decision: string; narrowing: string }>;
};
const modeExecutor = source('src/content/logic/mode-executor.ts');
const coordinator = source('src/background/control-coordinator.ts');
const shortcuts = source('src/background/shortcuts.ts');
const capture = source('src/background/handlers/capture.ts');

describe('SPECTRA tabCapture least-privilege boundary', () => {
	test('keeps tabCapture required only because it is a core full-output strategy', () => {
		expect(manifest.permissions).toContain('tabCapture');
		expect(manifest.optional_permissions).not.toContain('tabCapture');
		expect(policy.permissions.tabCapture?.decision).toBe('required');
		expect(policy.permissions.tabCapture?.narrowing).toContain('one-shot');
	});

	test('requires an admitted Capture ticket and a real processor contribution', () => {
		expect(modeExecutor).toContain("captureAdmission?.kind !== 'capture-start'");
		expect(modeExecutor).toContain('Capture policy was selected without an enabled processor contribution');
		expect(modeExecutor).toContain('Media WebAudio coverage is not complete and proven safe');
	});

	test('admits a new Capture only for the same current foreground target document', () => {
		expect(coordinator).toContain('if (!sameExtensionDocument(invocation.foreground, invocation.target)) return undefined;');
		expect(coordinator).toContain("chrome.tabs.query({ active: true, currentWindow: true })");
		expect(coordinator).toContain('if (tabs[0]?.id !== tabId) return undefined;');
		expect(coordinator).toContain('await assertInvocationTargetCurrent(tabId, invocation);');
		expect(coordinator).toContain('return mintCaptureAdmission({');
		expect(source('src/background/capture-admission.ts')).toContain('consumeCaptureAdmission');
	});

	test('treats current-page hotkeys and Chrome commands as explicit extension invocations', () => {
		expect(shortcuts).toContain("'builtin-page'");
		expect(shortcuts).toContain("'site-page'");
		expect(shortcuts).toContain("'chrome-command'");
		expect(shortcuts).toContain('submitExtensionInvokedControlRequest');
		expect(shortcuts).toContain('submitExtensionInvokedControlOperation');
	});

	test('never requests tabCapture permission from Background', () => {
		expect(capture).toContain('chrome.tabCapture.getMediaStreamId');
		expect(capture).not.toContain('chrome.permissions.request');
	});
});
