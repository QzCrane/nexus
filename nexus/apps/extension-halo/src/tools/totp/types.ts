// goal: TOTP type definitions

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpEntry {
	id: string;
	name: string;
	issuer: string;
	secret: string;
	digits: number;
	period: number;
	// Absent only for legacy records created by the SHA1-only implementation.
	algorithm?: TotpAlgorithm;
}

export interface TotpCode {
	code: string;
	remaining: number;
	period: number;
}
