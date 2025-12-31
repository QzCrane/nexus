// goal: Morse Code core logic - encode/decode

// Morse code map
const MORSE_MAP: Record<string, string> = {
	'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.', 'G': '--.', 'H': '....', 'I': '..', 'J': '.---',
	'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-',
	'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-', 'Y': '-.--', 'Z': '--..',
	'0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
	'.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...',
	':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-',
	'@': '.--.-.', ' ': '/',
};

// Reverse map
const DECODE_MAP = Object.fromEntries(Object.entries(MORSE_MAP).map(([k, v]) => [v, k]));

// Encode text to morse
export function encode(text: string): string {
	return text.toUpperCase().split('').map((c) => MORSE_MAP[c] || '?').join(' ');
}

// Decode morse to text
export function decode(morse: string): string {
	return morse.split(' ').map((m) => {
		if (m === '/') return ' ';
		return DECODE_MAP[m] || '?';
	}).join('');
}

// Play morse as audio
export function playMorse(morse: string, wpm = 15): void {
	const ctx = new AudioContext();
	const dot = 1.2 / wpm;
	const dash = dot * 3;
	const gap = dot;
	const letterGap = dot * 3;
	const wordGap = dot * 7;

	let time = ctx.currentTime;

	for (const char of morse) {
		if (char === '.') {
			playTone(ctx, time, dot);
			time += dot + gap;
		} else if (char === '-') {
			playTone(ctx, time, dash);
			time += dash + gap;
		} else if (char === ' ') {
			time += letterGap;
		} else if (char === '/') {
			time += wordGap;
		}
	}
}

function playTone(ctx: AudioContext, startTime: number, duration: number): void {
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.connect(gain);
	gain.connect(ctx.destination);
	osc.frequency.value = 600;
	gain.gain.value = 0.3;
	osc.start(startTime);
	osc.stop(startTime + duration);
}
