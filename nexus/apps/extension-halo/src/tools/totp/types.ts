// goal: TOTP type definitions

export interface TotpEntry {
	id: string;
	name: string;
	issuer: string;
	secret: string;
	digits: number;
	period: number;
}

export interface TotpCode {
	code: string;
	remaining: number;
	period: number;
}
