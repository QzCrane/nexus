
export const hydrateTranslations = (source: Record<string, any>): Record<string, any> => {
	const out: Record<string, any> = {};

	Object.keys(source).forEach(key => {
		const value = source[key];

		if (key.includes('.')) {
			const parts = key.split('.');
			let current = out;

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i]!;

				if (i === parts.length - 1) {
					// Leaf node
					current[part] = value;
				} else {
					// branches
					if (!current[part] || typeof current[part] !== 'object') {
						current[part] = {};
					}
					current = current[part];
				}
			}
		} else {
			// Top-level key
			if (out[key] && typeof out[key] === 'object' && typeof value === 'object') {
				// Merge existing object with new object
				// This handles cases where we unflattened 'a.b' -> {a:{b}} and now encounter 'a': {c}
				Object.assign(out[key], value);
			} else {
				// Simple assignment (or overwrite if collision)
				if (!out[key]) {
					out[key] = value;
				} else if (typeof out[key] === 'object' && typeof value === 'object') {
					Object.assign(out[key], value);
				} else {
					// Overwrite (last wins strategy usually, but here we prioritize existing structure)
					out[key] = value;
				}
			}
		}
	});

	return out;
};
