// goal: run the installed-Chrome smoke suite with an explicit browser locale
// inv: locale-sensitive Chrome presentation is never inherited from the host

import { spawnSync } from 'node:child_process';

const locale = process.argv[2]?.trim();
if (!locale || !/^[a-z]{2}(?:-[A-Z]{2})?$/u.test(locale)) {
	throw new Error('Smoke locale must be a BCP-47 language or language-region tag');
}

const result = spawnSync(process.execPath, ['test', 'test/smoke'], {
	env: { ...process.env, SPECTRA_SMOKE_LOCALE: locale },
	stdio: 'inherit',
	shell: false,
});

if (result.error) throw result.error;
if (result.status !== 0) {
	const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.status ?? 'unknown'}`;
	throw new Error(`SPECTRA ${locale} smoke failed: ${reason}`);
}
