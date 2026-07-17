// goal: one shared event name for the extension-owned isolated-world activation bridge

export const SPECTRA_TRUSTED_PIP_EVENT = 'spectra:trusted-pip-toggle:v1' as const;

export interface SpectraTrustedPipResult {
	active: boolean;
}
