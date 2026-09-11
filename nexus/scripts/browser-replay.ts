// Test-only replay policy; it never changes extension launch or user runtime policy.
import floor from '../browser-floor.json' with { type: 'json' };

export function browserReplayPolicy(expectedVersion: string | undefined, executablePath: string | undefined, platform: string) {
	const isFloor = expectedVersion === floor.chromeForTestingVersion;
	if (isFloor && !executablePath) throw new Error('Minimum-browser replay requires its exact executable');
	return {
		driver: isFloor ? 'floor' as const : 'current' as const,
		// Linux CI has no desktop GPU. Do not apply this to current-browser or desktop measurements.
		args: isFloor && platform === 'linux' ? ['--disable-gpu'] : [],
	};
}
