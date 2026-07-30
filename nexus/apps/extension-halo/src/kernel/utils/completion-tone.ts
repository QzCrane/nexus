// goal: One bounded owner for short user-initiated completion feedback

const TONE_DURATION_SECONDS = 0.14;

export async function playCompletionTone(): Promise<void> {
	const context = new AudioContext();
	const oscillator = context.createOscillator();
	const gain = context.createGain();

	try {
		if (context.state === 'suspended') await context.resume();

		const startedAt = context.currentTime;
		const endedAt = startedAt + TONE_DURATION_SECONDS;
		oscillator.type = 'sine';
		oscillator.frequency.setValueAtTime(880, startedAt);
		gain.gain.setValueAtTime(0.0001, startedAt);
		gain.gain.exponentialRampToValueAtTime(0.12, startedAt + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, endedAt);
		oscillator.connect(gain);
		gain.connect(context.destination);

		await new Promise<void>((resolve) => {
			oscillator.addEventListener('ended', () => resolve(), { once: true });
			oscillator.start(startedAt);
			oscillator.stop(endedAt);
		});
	} finally {
		oscillator.disconnect();
		gain.disconnect();
		if (context.state !== 'closed') await context.close();
	}
}
