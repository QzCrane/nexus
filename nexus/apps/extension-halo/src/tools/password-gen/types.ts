// goal: Password Generator type definitions

export interface PasswordConfig {
	length: number;
	uppercase: boolean;
	lowercase: boolean;
	numbers: boolean;
	symbols: boolean;
	excludeAmbiguous: boolean; // Exclude O, 0, l, 1, etc.
	customSymbols: string;
}

export interface PasswordStrength {
	score: number; // 0-4
	label: string;
	color: string;
	feedback: string[];
}
