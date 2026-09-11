// goal: Password Generator core logic - generate and evaluate passwords

import type { PasswordConfig, PasswordStrength } from './types';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const AMBIGUOUS = 'O0lI1';

// Rejection sampling makes every unique Unicode scalar equiprobable. Selection
// enables a pool; it does not promise that every class occurs in each password.
export function passwordAlphabet(config: PasswordConfig): string[] {
	const source = (config.uppercase ? UPPERCASE : '') + (config.lowercase ? LOWERCASE : '')
		+ (config.numbers ? NUMBERS : '') + (config.symbols ? config.customSymbols || SYMBOLS : '');
	if (source.length > 4096) throw new RangeError('Custom character pool exceeds 4096 UTF-16 units');
	const alphabet = [...new Set(source)].filter((char) => !config.excludeAmbiguous || !AMBIGUOUS.includes(char));
	if (alphabet.some((char) => { const code = char.codePointAt(0) ?? 0; return code >= 0xD800 && code <= 0xDFFF; })) {
		throw new Error('Character pool contains an unpaired surrogate');
	}
	return alphabet;
}

export function generatePassword(config: PasswordConfig): string {
	if (!Number.isSafeInteger(config.length) || config.length < 1 || config.length > 4096) {
		throw new RangeError('Password length must be an integer from 1 to 4096');
	}
	const alphabet = passwordAlphabet(config);
	if (alphabet.length === 0) return '';
	const ceiling = 0x100000000 - (0x100000000 % alphabet.length);
	const output: string[] = [];
	const random = new Uint32Array(Math.min(256, config.length));
	// A broken entropy provider must not leave the UI in an infinite retry loop.
	for (let batch = 0; output.length < config.length && batch < config.length + 64; batch++) {
		crypto.getRandomValues(random);
		for (const value of random) {
			if (value >= ceiling) continue;
			const char = alphabet[value % alphabet.length];
			if (char === undefined) throw new Error('Random index outside character pool');
			output.push(char);
			if (output.length === config.length) break;
		}
	}
	if (output.length !== config.length) throw new Error('Random source did not produce an accepted sample');
	return output.join('');
}

export function generatePasswords(config: PasswordConfig, count: number): string[] {
	if (!Number.isSafeInteger(count) || count < 1 || count > 1000 || count * config.length > 65536) {
		throw new RangeError('Password batch exceeds the interactive output limit');
	}
	return Array.from({ length: count }, () => generatePassword(config));
}

// Evaluate password strength
export function evaluateStrength(password: string): PasswordStrength {
	let score = 0;
	const feedback: string[] = [];

	// Length checks
	if (password.length >= 8) score++;
	if (password.length >= 12) score++;
	if (password.length >= 16) score++;
	if (password.length < 8) feedback.push('Too short (min 8 chars)');

	// Character variety
	const hasUpper = /[A-Z]/.test(password);
	const hasLower = /[a-z]/.test(password);
	const hasNumber = /[0-9]/.test(password);
	const hasSymbol = /[^A-Za-z0-9]/.test(password);

	const variety = [hasUpper, hasLower, hasNumber, hasSymbol].filter(Boolean).length;
	if (variety >= 3) score++;
	if (variety < 3) feedback.push('Add more character types');

	// Patterns to avoid
	if (/(.)\1{2,}/.test(password)) {
		score = Math.max(0, score - 1);
		feedback.push('Avoid repeated characters');
	}
	if (/^[a-zA-Z]+$/.test(password)) {
		feedback.push('Add numbers or symbols');
	}

	// Normalize score
	score = Math.min(4, Math.max(0, score));

	const labels = ['Very low complexity', 'Low complexity', 'Moderate complexity', 'High complexity', 'Very high complexity'] as const;
	const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'] as const;

	return {
		score,
		label: labels[score] ?? labels[0],
		color: colors[score] ?? colors[0],
		feedback: [...feedback, 'Heuristic only: character variety cannot prove entropy or resistance to guessing.'],
	};
}

// Default config
export const DEFAULT_CONFIG: PasswordConfig = {
	length: 16,
	uppercase: true,
	lowercase: true,
	numbers: true,
	symbols: true,
	excludeAmbiguous: false,
	customSymbols: '',
};
