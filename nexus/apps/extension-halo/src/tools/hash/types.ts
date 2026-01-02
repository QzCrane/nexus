// goal: Hash tool type definitions

// Standard hash algorithms (Web Crypto API native)
export type HashAlgorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

// All supported algorithms for display
export const ALGORITHMS: HashAlgorithm[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

// HMAC key input
export interface HMACConfig {
	enabled: boolean;
	key: string;
}

export interface HashState {
	input: string;
	algorithm: HashAlgorithm;
	hash: string;
	uppercase: boolean;
	loading: boolean;
	hmac?: HMACConfig;
}

// Hash verification
export interface VerifyResult {
	match: boolean;
	algorithm?: HashAlgorithm;
}
