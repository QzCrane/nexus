// goal: Hash tool type definitions

export type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export interface HashState {
	input: string;
	algorithm: HashAlgorithm;
	hash: string;
	uppercase: boolean;
	loading: boolean;
}

export const ALGORITHMS: HashAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
