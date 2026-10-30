// goal: one real media fixture for inventory tests
//
// The media inventory asks a document a strict question: does it hold a source the
// user could control (shared/media-presence.ts)? A `<video>` element with no source
// is a player shell - exactly the thing that must never become a card - so fixtures
// that want to model a media tab have to serve one.
//
// This is a 0.1s silent 8 kHz mono WAV. It is small, it decodes synchronously over
// loopback, and a paused `<video src>` playing it reaches HAVE_METADATA without any
// user gesture, which is the cheapest honest stand-in for "a paused player".

const SAMPLE_RATE = 8_000;
const DURATION_SECONDS = 0.1;

export function toneWav(): Uint8Array {
	const samples = Math.floor(SAMPLE_RATE * DURATION_SECONDS);
	const bytes = new Uint8Array(44 + samples);
	const view = new DataView(bytes.buffer);
	const ascii = (offset: number, text: string): void => {
		for (let index = 0; index < text.length; index += 1) {
			view.setUint8(offset + index, text.charCodeAt(index));
		}
	};
	ascii(0, 'RIFF');
	view.setUint32(4, 36 + samples, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true);      // PCM header size
	view.setUint16(20, 1, true);       // PCM
	view.setUint16(22, 1, true);       // mono
	view.setUint32(24, SAMPLE_RATE, true);
	view.setUint32(28, SAMPLE_RATE, true); // byte rate (8-bit mono)
	view.setUint16(32, 1, true);       // block align
	view.setUint16(34, 8, true);       // bits per sample
	ascii(36, 'data');
	view.setUint32(40, samples, true);
	bytes.fill(0x80, 44);              // unsigned 8-bit silence
	return bytes;
}

export const TONE_PATH = '/tone.wav';

export function toneResponse(): Response {
	return new Response(toneWav(), {
		headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' },
	});
}

/** A page whose only media is one paused element with a real source. */
export function pausedMediaPage(title: string, options: { muted?: boolean } = {}): Response {
	const muted = options.muted ? ' muted' : '';
	return new Response(
		`<!doctype html><html><head><title>${title}</title></head><body>`
		+ `<video id="media" controls${muted} preload="auto" src="${TONE_PATH}"></video>`
		+ '</body></html>',
		{ headers: { 'content-type': 'text/html; charset=utf-8' } },
	);
}
