import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

// Run the real settings owner in an isolated realm. Its actual transport and
// locale loader remain in the path; no module mocks can leak to other specs.
test('publishes applied settings only after a gated locale commits and retires subscribers', async () => {
	const child = Bun.spawn([process.execPath, 'run', '-'], {
		cwd: resolve(import.meta.dir, '..'), stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
	});
	child.stdin.write(`
import assert from 'node:assert/strict';
import { DEFAULT_GLOBAL_SETTINGS, DEFAULT_HOTKEY_SETTINGS, SPECTRA_SETTINGS_SCHEMA_VERSION, createSpectraEvent, rpcSuccess } from '@nexus/contracts';
const handlers = new Set();
const root = { setAttribute() {}, getAttribute() { return null; }, lang: 'en-US' };
globalThis.document = { documentElement: root, getElementById() { return null; }, querySelectorAll() { return []; } };
globalThis.window = {
  localStorage: { setItem() {} }, addEventListener() {},
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; },
};
const snapshot = revision => ({ schemaVersion: SPECTRA_SETTINGS_SCHEMA_VERSION, revision,
  globalSettings: { ...DEFAULT_GLOBAL_SETTINGS, lang: 'en-US', pauseRetentionSeconds: 60 },
  hotkeySettings: structuredClone(DEFAULT_HOTKEY_SETTINGS), audioSites: {}, audioPresets: {}, defaultPresetId: null });
globalThis.chrome = { runtime: { id: 'settings-fixture', getURL: path => 'https://fixture.test/' + path,
  onMessage: { addListener: fn => handlers.add(fn), removeListener: fn => handlers.delete(fn) },
  sendMessage: async () => rpcSuccess(snapshot(1)) } };
const { EN_US } = await import('./src/popup/constants/i18n/en.ts');
const { installPrepaintPopupCatalogs } = await import('./src/shared/i18n/popup-catalog.ts');
installPrepaintPopupCatalogs({ 'en-US': EN_US });
const english = Object.fromEntries(Object.entries(EN_US).map(([key, value]) =>
  [key, typeof value === 'function' ? value('__SPECTRA_I18N_VALUE__') : value]));
let releaseLocale;
const localeGate = new Promise(resolve => { releaseLocale = resolve; });
let localeStarted;
const started = new Promise(resolve => { localeStarted = resolve; });
globalThis.fetch = async url => {
  if (String(url).includes('/zh-CN.')) { localeStarted(); await localeGate; }
  return new Response(Bun.gzipSync(JSON.stringify(String(url).includes('/en-US.') ? english : {})));
};
const { initSettings } = await import('./src/popup/views/settings.ts');
const state = await initSettings();
const applied = [];
let observed;
const observeNext = () => new Promise(resolve => { observed = resolve; });
state.onAppliedRevision(revision => {
  applied.push({ revision, stateRevision: state.revision, retention: state.gSettings.pauseRetentionSeconds });
  observed?.();
});
const publish = next => {
  const event = createSpectraEvent('spectra.settings.changed', next);
  for (const handler of handlers) handler(event);
};
const next = snapshot(2);
next.globalSettings.lang = 'zh-CN';
next.globalSettings.pauseRetentionSeconds = 0;
const committed = observeNext();
publish(next);
await started;
assert.equal(state.revision, 1);
assert.equal(state.gSettings.pauseRetentionSeconds, 60);
assert.deepEqual(applied, []);
releaseLocale();
await committed;
assert.deepEqual(applied, [{ revision: 2, stateRevision: 2, retention: 0 }]);
publish(snapshot(1));
publish(next);
await Promise.resolve();
assert.equal(applied.length, 1);
const third = { ...next, revision: 3 };
const thirdCommitted = observeNext();
publish(third);
await thirdCommitted;
assert.deepEqual(applied.map(item => item.revision), [2, 3]);
state.dispose();
publish({ ...next, revision: 4 });
await Promise.resolve();
assert.equal(state.revision, 3);
assert.equal(applied.length, 2);
console.log('applied-after-locale-and-disposal: PASS');
`);
	child.stdin.end();
	try {
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
		]);
		expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
		expect(stdout).toContain('applied-after-locale-and-disposal: PASS');
	} finally {
		if (child.exitCode === null) child.kill();
	}
}, 10_000);
