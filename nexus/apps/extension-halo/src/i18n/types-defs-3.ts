// goal: Detailed translation interface definitions part 3
// eff: Split from main types.ts to reduce file size

export interface PanelsDevTranslations {
	regex: {
		patternPlaceholder: string;
		testString: string;
		testPlaceholder: string;
		replaceMode: string;
		replacePlaceholder: string;
		matches: string;
	};
	base64: {
		encode: string;
		decode: string;
		urlSafe: string;
		input: string;
		output: string;
		inputPlaceholder: string;
		decodePlaceholder: string;
		outputPlaceholder: string;
		dropFile: string;
		swap: string;
	};
	hash: {
		input: string;
		placeholder: string;
		output: string;
	};
	uuid: {
		count: string;
		generate: string;
		placeholder: string;
	};
	timestamp: {
		input: string;
		output: string;
		current: string;
	};
	url: {
		encode: string;
		decode: string;
		parse: string;
		input: string;
		output: string;
	};
}
