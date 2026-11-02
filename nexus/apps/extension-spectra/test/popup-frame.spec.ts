import { describe, expect, test } from 'bun:test';
import { popupCardCount } from '../src/background/popup-frame';
import { actionPopupPath, readPopupAppearance } from '../src/shared/popup-bootstrap';

// The count is the only layout fact that can exist before the Popup does. It has
// to answer exactly the question the Popup will answer from its inventory, or the
// window opens sized for cards that are not there. These are the four shapes the
// rule has, none of which needs a browser to pin.
describe('popup card count', () => {
	test('separates a restricted active page from background cards without leaking tab identity', () => {
		const path = actionPopupPath(2, { hasMainCard: false, language: 'zh-CN', visualizerEnabled: false });
		expect(path).toBe('popup.html?cards=2&main=0&lang=zh-CN&viz=0');
		expect(readPopupAppearance(new URL(path, 'https://fixture.test').search)).toEqual({
			hasMainCard: false, language: 'zh-CN', visualizerEnabled: false,
		});
		for (const query of ['', '?cards=2', '?main=1&lang=zh-CN', '?main=yes&lang=zh-CN&viz=1', '?main=1&lang=unknown&viz=1']) {
			expect(readPopupAppearance(query)).toBeNull();
		}
	});
	test('counts the active card plus every other media tab', () => {
		expect(popupCardCount({ id: 7, url: 'https://video.example/watch' }, [7, 8, 9])).toBe(3);
	});

	test('does not count the active tab twice', () => {
		// The inventory lists the active tab when it holds media; the Popup renders
		// it in the main stage, not in the background stack.
		expect(popupCardCount({ id: 7, url: 'https://video.example/watch' }, [7])).toBe(1);
		expect(popupCardCount({ id: 7, url: 'https://video.example/watch' }, [])).toBe(1);
	});

	test('draws no card for a restricted active tab', () => {
		// chrome:// pages get no card, so the Popup shows its empty state - which is
		// a shape of its own, keyed by the background cards that are still listed.
		expect(popupCardCount({ id: 3, url: 'chrome://settings' }, [])).toBe(0);
		expect(popupCardCount({ id: 3, url: 'chrome://settings' }, [3, 8])).toBe(1);
		expect(popupCardCount({ id: 3, url: undefined }, [8])).toBe(1);
	});

	test('refuses to guess without an active tab', () => {
		expect(popupCardCount(null, [1, 2])).toBeNull();
		expect(popupCardCount(undefined, [])).toBeNull();
		expect(popupCardCount({ id: undefined, url: 'https://a.example' } as never, [])).toBeNull();
	});
});
