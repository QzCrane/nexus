// goal: the single owner of the pairing-window rule
//
// `pairingExpiresAt` bounds the pairing window only. It is not a session
// lifetime: a peer that already authenticated keeps its session, while a session
// that never paired must stop being offered once the window closes.
//
// This lives on its own because both Background and Offscreen must apply the same
// rule, and because a duplicated comparison is exactly how the two of them drifted
// apart before: Offscreen enforced the window and Background never read the field
// at all.

export interface PairingWindow {
	readonly connected: boolean;
	readonly pairingExpiresAt: number;
}

export function isPairingWindowExpired(session: PairingWindow, now: number): boolean {
	if (session.connected === true) return false;
	return session.pairingExpiresAt <= now;
}
