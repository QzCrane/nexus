// goal: ROT13/ROT47 core logic

// ROT13 implementation (A-Z, a-z)
export function rot13(input: string): string {
	return input.replace(/[a-zA-Z]/g, (c) => {
		const code = c.charCodeAt(0);
		const base = code <= 90 ? 65 : 97;
		return String.fromCharCode(base + (code - base + 13) % 26);
	});
}

// ROT47 implementation (ASCII 33-126)
export function rot47(input: string): string {
	const chars: string[] = [];
	for (let i = 0; i < input.length; i++) {
		let code = input.charCodeAt(i);
		if (code >= 33 && code <= 126) {
			code = 33 + ((code + 14) % 94);
		}
		chars.push(String.fromCharCode(code));
	}
	return chars.join('');
}

// ROT N implementation (custom shift)
export function rotN(input: string, n: number): string {
	return input.replace(/[a-zA-Z]/g, (c) => {
		const code = c.charCodeAt(0);
		const base = code <= 90 ? 65 : 97;
		// Handle negative shifts
		const shift = ((n % 26) + 26) % 26;
		return String.fromCharCode(base + (code - base + shift) % 26);
	});
}
