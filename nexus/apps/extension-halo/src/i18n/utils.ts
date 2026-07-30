
type TranslationRecord = Record<string, unknown>;

function isTranslationRecord(value: unknown): value is TranslationRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const hydrateTranslations = (source: TranslationRecord): TranslationRecord => {
	const out: TranslationRecord = {};

	Object.keys(source).forEach(key => {
		const value = source[key];

		if (key.includes('.')) {
			const parts = key.split('.');
			let current: TranslationRecord = out;

			for (const [i, part] of parts.entries()) {

				if (i === parts.length - 1) {
					// Leaf node
					current[part] = value;
				} else {
					// branches
					const branch = current[part];
					if (isTranslationRecord(branch)) {
						current = branch;
					} else {
						const next: TranslationRecord = {};
						current[part] = next;
						current = next;
					}
				}
			}
		} else {
			// Top-level key
			const existing = out[key];
			if (isTranslationRecord(existing) && isTranslationRecord(value)) {
				// Merge existing object with new object
				// This handles cases where we unflattened 'a.b' -> {a:{b}} and now encounter 'a': {c}
				Object.assign(existing, value);
			} else {
				// Simple assignment (or overwrite if collision)
				if (!existing) {
					out[key] = value;
				} else if (isTranslationRecord(existing) && isTranslationRecord(value)) {
					Object.assign(existing, value);
				} else {
					// Overwrite (last wins strategy usually, but here we prioritize existing structure)
					out[key] = value;
				}
			}
		}
	});

	return out;
};
