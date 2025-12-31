// goal: Password Generator core logic - generate and evaluate passwords

import type { PasswordConfig, PasswordStrength } from './types';

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
const AMBIGUOUS = 'O0lI1';

// Generate a single password
export function generatePassword(config: PasswordConfig): string {
	let charset = '';
	if (config.uppercase) charset += UPPERCASE;
	if (config.lowercase) charset += LOWERCASE;
	if (config.numbers) charset += NUMBERS;
	if (config.symbols) charset += config.customSymbols || SYMBOLS;

	// Remove ambiguous characters if requested
	if (config.excludeAmbiguous) {
		charset = charset.split('').filter((c) => !AMBIGUOUS.includes(c)).join('');
	}

	if (!charset) return '';

	// Use crypto for secure random generation
	const array = new Uint32Array(config.length);
	crypto.getRandomValues(array);

	return Array.from(array)
		.map((n) => charset[n % charset.length])
		.join('');
}

// Generate multiple passwords
export function generatePasswords(config: PasswordConfig, count: number): string[] {
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

	const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
	const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#10b981'];

	return {
		score,
		label: labels[score],
		color: colors[score],
		feedback: feedback.length ? feedback : ['Good password!'],
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
