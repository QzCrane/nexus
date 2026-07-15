// goal: synchronize playback rate using standard events without patching native prototypes

const TARGET_MESSAGE = 'SPECTRA_TARGET_SPEED';

export function hijackPlaybackRate(): () => void {
	let targetSpeed = 1;
	let active = false;
	let frame = 0;
	const applyTarget = () => {
		frame = 0;
		for (const media of document.querySelectorAll<HTMLMediaElement>('video, audio')) {
			if (Math.abs(media.playbackRate - targetSpeed) > 0.005) media.playbackRate = targetSpeed;
		}
	};
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(applyTarget);
	};
	const messageListener = (event: MessageEvent) => {
		if (event.source !== window) return;
		if (event.data?.type === 'SPECTRA_CLEAR_TARGET_SPEED') {
			active = false;
			targetSpeed = 1;
			if (frame) {
				cancelAnimationFrame(frame);
				frame = 0;
			}
			return;
		}
		if (event.data?.type !== TARGET_MESSAGE) return;
		const speed = Number(event.data.speed);
		if (!Number.isFinite(speed)) return;
		active = true;
		targetSpeed = Math.max(0.1, Math.min(16, speed));
		schedule();
	};
	const observer = new MutationObserver((mutations) => {
		if (!active) return;
		if (mutations.some((mutation) => mutation.addedNodes.length > 0)) schedule();
	});

	window.addEventListener('message', messageListener);
	observer.observe(document, { childList: true, subtree: true });
	return () => {
		window.removeEventListener('message', messageListener);
		observer.disconnect();
		if (frame) cancelAnimationFrame(frame);
	};
}
