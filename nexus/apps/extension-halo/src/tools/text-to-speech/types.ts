// goal: Text-to-Speech type definitions

export interface TtsSettings {
	rate: number;      // 0.1 - 10
	pitch: number;     // 0 - 2
	volume: number;    // 0 - 1
	voiceUri: string;
}
