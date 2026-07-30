// goal: JWT Decoder core logic - parse JWT without verification

import type { JwtParts } from './types';

// Base64URL decode
function base64UrlDecode(str: string): string {
	const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
	const pad = base64.length % 4;
	const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
	return atob(padded);
}

// Decode JWT
export function decodeJwt(token: string): JwtParts | null {
	try {
		const parts = token.trim().split('.');
		if (parts.length !== 3) return null;
		const [headerPart, payloadPart, signature = ''] = parts;
		if (headerPart === undefined || payloadPart === undefined) return null;

		const header = JSON.parse(base64UrlDecode(headerPart));
		const payload = JSON.parse(base64UrlDecode(payloadPart));

		// Check expiration
		let isExpired = false;
		let expiresAt: Date | undefined;
		if (typeof payload.exp === 'number') {
			expiresAt = new Date(payload.exp * 1000);
			isExpired = expiresAt < new Date();
		}

		return { header, payload, signature, isExpired, expiresAt };
	} catch {
		return null;
	}
}

// Format timestamp claims
export function formatClaim(key: string, value: unknown): string {
	if (['exp', 'iat', 'nbf'].includes(key) && typeof value === 'number') {
		return new Date(value * 1000).toLocaleString();
	}
	return JSON.stringify(value);
}

// Known claims
export const KNOWN_CLAIMS: Record<string, string> = {
	iss: 'Issuer',
	sub: 'Subject',
	aud: 'Audience',
	exp: 'Expiration Time',
	nbf: 'Not Before',
	iat: 'Issued At',
	jti: 'JWT ID',
};
