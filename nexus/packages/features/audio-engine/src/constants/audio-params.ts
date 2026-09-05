// goal: central definition of Capture graph processing parameters

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_Q = 1.4;
export const BASS_FREQUENCY = 200;
export const BASS_GAIN = 10;
export const FFT_SIZE = 256;

// Compatibility projection for tests and UI-facing architecture readers. The
// graph imports the named owners above so production can tree-shake this object.
export const AudioParams = { EQ_FREQUENCIES, EQ_Q, BASS_FREQUENCY, BASS_GAIN, FFT_SIZE } as const;

// goal: aggressive compression settings to prevent clipping/distortion during high gain
export const COMPRESSOR_THRESHOLD = -24;
export const COMPRESSOR_KNEE = 30;
export const COMPRESSOR_RATIO = 12;
export const COMPRESSOR_ATTACK = 0.003;
export const COMPRESSOR_RELEASE = 0.25;

// Compatibility projection for tests and architecture readers; graph code uses
// the named constants so this object is not pulled into the Capture bundle.
export const CompressorOn = {
	threshold: COMPRESSOR_THRESHOLD,
	knee: COMPRESSOR_KNEE,
	ratio: COMPRESSOR_RATIO,
	attack: COMPRESSOR_ATTACK,
	release: COMPRESSOR_RELEASE,
} as const;
