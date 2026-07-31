// goal: central brand and state color tokens used across the UI layer

export const UIColors = {
	// CAPTURE: purple only after the matching Capture runtime is active
	CAPTURE: '#7c3aed',
	// NATIVE: blue for native, Media WebAudio and every non-active transition
	NATIVE: '#2563eb',
	// MUTED: gray for silent output (muted or zero volume)
	MUTED: '#9ca3af',
	// DISABLED: neutral gray when audio enhancement is off but usage is acknowledged
	DISABLED: '#94a3b8',
	WHITE: '#ffffff',
} as const;
