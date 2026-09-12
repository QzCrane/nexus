// goal: PDF operation config utilities
// eff: Page range parsing, validation

// Parse page ranges like "1-3, 5" into ranges array (0-indexed)
export const parseRanges = (input: string): { start: number; end: number }[] => {
	const ranges: { start: number; end: number }[] = [];
	const parts = input.split(',').map((s) => s.trim()).filter(Boolean);
	for (const part of parts) {
		if (part.includes('-')) {
			const [a, b] = part.split('-').map((n) => parseInt(n.trim(), 10) - 1);
			if (a !== undefined && b !== undefined && !Number.isNaN(a) && !Number.isNaN(b) && a >= 0 && b >= a) ranges.push({ start: a, end: b });
		} else {
			const n = parseInt(part, 10) - 1;
			if (!Number.isNaN(n) && n >= 0) ranges.push({ start: n, end: n });
		}
	}
	return ranges;
};

// Parse page list like "1, 3, 5-10" into page indices (0-indexed)
export const parsePages = (input: string): number[] => {
	const pages: number[] = [];
	const ranges = parseRanges(input);
	for (const r of ranges) {
		if (r.end - r.start + 1 > 2_000 - pages.length) {
			throw new RangeError('Page selection exceeds the 2000-page limit.');
		}
		for (let i = r.start; i <= r.end; i++) pages.push(i);
	}
	return [...new Set(pages)].sort((a, b) => a - b);
};

// Format file size
export const formatSize = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1048576).toFixed(1)} MB`;
};
