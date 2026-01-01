// goal: XOR core logic

// XOR string with key
export function xor(input: string, key: string): string {
	let result = '';
	for (let i = 0; i < input.length; i++) {
		const charCode = input.charCodeAt(i) ^ key.charCodeAt(i % key.length);
		result += String.fromCharCode(charCode);
	}
	return result;
}

// Convert string to hex space separated
export function toHex(input: string): string {
	return input.split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
}

// Convert hex to string
export function fromHex(hex: string): string {
	const clean = hex.replace(/\s/g, '');
	let str = '';
	for (let i = 0; i < clean.length; i += 2) {
		str += String.fromCharCode(parseInt(clean.substr(i, 2), 16));
	}
	return str;
}
