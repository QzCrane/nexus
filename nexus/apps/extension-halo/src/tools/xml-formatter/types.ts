// goal: XML Formatter type definitions

export interface XmlResult {
	formatted: string;
	valid: boolean;
	error?: string;
	warning?: string;
	stats: {
		elements: number;
		attributes: number;
	};
}
