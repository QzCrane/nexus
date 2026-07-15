import { describe, expect, test } from 'bun:test';
import { isTopLevelDocumentNavigation } from '../src/background/lifecycle';

describe('background document lifecycle', () => {
	test('clears only top-level replacement navigations', () => {
		expect(isTopLevelDocumentNavigation({ frameId: 0 })).toBe(true);
		expect(isTopLevelDocumentNavigation({ frameId: 1 })).toBe(false);
		expect(isTopLevelDocumentNavigation({ frameId: 42 })).toBe(false);
	});
});
