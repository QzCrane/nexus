// goal: parses numeric Popup control text without treating the valid value zero as absence

export function parseFiniteControlInput(value: string, fallback: number): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}
