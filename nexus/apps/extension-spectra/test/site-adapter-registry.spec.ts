// goal: keep the declared site adapter registry honest — host boundaries, schema
// invariants, and the clamping that makes traversal cost a property of the data

import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_SITE_ADAPTER_DISCOVERY,
	GENERIC_PAGE_MEDIA_VOCABULARY,
	SITE_ADAPTER_LIMITS,
	SITE_ADAPTER_REGISTRY,
	describeSiteAdapter,
	resolveSiteAdapter,
	siteAdapterBounds,
	siteAdapterMatchesHost,
} from '../src/shared/site-adapter-registry';

const douyin = SITE_ADAPTER_REGISTRY.find((entry) => entry.id === 'douyin-speed');
// A missing row is a wiring failure, not a skipped test: every assertion below
// exists to keep that row honest.
if (!douyin) throw new Error('the site adapter registry must ship the douyin-speed row');

/**
 * Counts capturing groups in a regex source. Escapes are stripped first, and any
 * `(?` prefix (non-capturing, lookaround, or named) is skipped, which is exactly
 * the subset a projection pattern is allowed to use.
 */
function captureGroupCount(source: string): number {
	const stripped = source.replace(/\\./g, '');
	let count = 0;
	for (let index = 0; index < stripped.length; index += 1) {
		if (stripped[index] !== '(') continue;
		if (stripped[index + 1] === '?') continue;
		count += 1;
	}
	return count;
}

describe('site adapter host matching', () => {
	test('covers bare and subdomain hosts but never a lookalike', () => {
		expect(siteAdapterMatchesHost(douyin, 'douyin.com')).toBe(true);
		expect(siteAdapterMatchesHost(douyin, 'www.douyin.com')).toBe(true);
		expect(siteAdapterMatchesHost(douyin, 'M.DOUYIN.COM')).toBe(true);
		expect(siteAdapterMatchesHost(douyin, 'www.iesdouyin.com')).toBe(true);
		// The dot boundary is the whole point: a suffix match without it would let
		// any lookalike domain inherit a row written for someone else.
		expect(siteAdapterMatchesHost(douyin, 'evildouyin.com')).toBe(false);
		expect(siteAdapterMatchesHost(douyin, 'douyin.com.evil.test')).toBe(false);
		expect(siteAdapterMatchesHost(douyin, '')).toBe(false);
	});

	test('resolves per field, so a speed row never answers a volume probe', () => {
		expect(resolveSiteAdapter('www.douyin.com', 'speed')?.id).toBe('douyin-speed');
		expect(resolveSiteAdapter('www.douyin.com', 'volumeBase')).toBeNull();
		expect(resolveSiteAdapter('www.douyin.com', 'mediaMuted')).toBeNull();
		expect(resolveSiteAdapter('example.com', 'speed')).toBeNull();
	});
});

describe('site adapter registry invariants', () => {
	test('every row is well formed and every declared name is probeable', () => {
		const ids = new Set<string>();
		for (const entry of SITE_ADAPTER_REGISTRY) {
			expect(entry.id.length).toBeGreaterThan(0);
			expect(ids.has(entry.id)).toBe(false);
			ids.add(entry.id);
			expect(entry.revision).toBeGreaterThanOrEqual(1);
			expect(entry.hosts.length).toBeGreaterThan(0);
			expect(entry.discovery.setterNames.length).toBeGreaterThan(0);
			expect(entry.discovery.getterNames.length).toBeGreaterThan(0);
			expect(entry.discovery.associationKeys.length).toBeGreaterThan(0);
			for (const name of [
				...entry.discovery.setterNames,
				...entry.discovery.getterNames,
				...entry.discovery.accessorNames,
				...entry.discovery.associationKeys,
			]) {
				// A blank or padded name would silently never match a real property.
				expect(name).toBe(name.trim());
				expect(name.length).toBeGreaterThan(0);
			}
		}
	});

	test('a projection pattern must capture exactly one number', () => {
		for (const entry of SITE_ADAPTER_REGISTRY) {
			const projection = entry.projection;
			if (!projection) continue;
			expect(projection.tolerance).toBeGreaterThan(0);
			expect(projection.patterns.length).toBeGreaterThan(0);
			expect(projection.scopeSelectors.length).toBeLessThanOrEqual(
				SITE_ADAPTER_LIMITS.maxProjectionScopes,
			);
			for (const source of projection.patterns) {
				// One capture group is the contract: the bridge parses group 1 and
				// ignores everything else, so a second group would be silently lost.
				expect(captureGroupCount(source)).toBe(1);
				// And it must actually be anchored, or a stray "12:34" in a comment
				// would be read as a playback rate.
				expect(source.startsWith('^')).toBe(true);
				expect(source.endsWith('$')).toBe(true);
			}
		}
	});

	test('the shipped rows are candidates until the runbook files evidence', () => {
		// EPR-028: a row may not claim verification it has not earned. Flipping
		// this to `verified` requires docs/research/evidence/ from a live tab.
		for (const entry of SITE_ADAPTER_REGISTRY) {
			expect(['candidate', 'verified']).toContain(entry.status);
			expect(entry.status).not.toBe('disabled');
		}
		expect(douyin.status).toBe('candidate');
	});

	test('a row may not repeat a generic name and expect priority', () => {
		// Declared names are additions, not repetitions. A repeated name cannot
		// confer priority, so a row that restated `setPlaybackRate` would lose to
		// any nearer generic controller while looking correct in review.
		const generic = new Set<string>([
			...GENERIC_PAGE_MEDIA_VOCABULARY.speedSetterNames,
			...GENERIC_PAGE_MEDIA_VOCABULARY.speedGetterNames,
			...GENERIC_PAGE_MEDIA_VOCABULARY.speedAccessorNames,
			...GENERIC_PAGE_MEDIA_VOCABULARY.mediaReferenceKeys,
			...GENERIC_PAGE_MEDIA_VOCABULARY.rootReferenceKeys,
		]);
		for (const entry of SITE_ADAPTER_REGISTRY) {
			const overlapping = [
				...entry.discovery.setterNames,
				...entry.discovery.getterNames,
				...entry.discovery.accessorNames,
				...entry.discovery.associationKeys,
			].filter((name) => generic.has(name));
			expect({ row: entry.id, overlapping }).toEqual({ row: entry.id, overlapping: [] });
		}
	});
});

describe('site adapter bounds', () => {
	test('defaults to the generic traversal when no row is present', () => {
		expect(siteAdapterBounds(null)).toEqual({
			maxAncestorDepth: DEFAULT_SITE_ADAPTER_DISCOVERY.maxAncestorDepth,
			maxAttachedProperties: DEFAULT_SITE_ADAPTER_DISCOVERY.maxAttachedProperties,
			maxPrototypeDepth: DEFAULT_SITE_ADAPTER_DISCOVERY.maxPrototypeDepth,
		});
	});

	test('a row may widen a bound but never past the hard ceiling', () => {
		expect(siteAdapterBounds({
			...DEFAULT_SITE_ADAPTER_DISCOVERY,
			maxAncestorDepth: 9999,
			maxAttachedProperties: 9999,
			maxPrototypeDepth: 9999,
		})).toEqual({
			maxAncestorDepth: SITE_ADAPTER_LIMITS.maxAncestorDepth,
			maxAttachedProperties: SITE_ADAPTER_LIMITS.maxAttachedProperties,
			maxPrototypeDepth: SITE_ADAPTER_LIMITS.maxPrototypeDepth,
		});
		// A malformed row falls back instead of disabling the field entirely.
		expect(siteAdapterBounds({
			...DEFAULT_SITE_ADAPTER_DISCOVERY,
			maxAncestorDepth: Number.NaN,
			maxAttachedProperties: -1,
			maxPrototypeDepth: Number.POSITIVE_INFINITY,
		})).toEqual({ maxAncestorDepth: 12, maxAttachedProperties: 96, maxPrototypeDepth: 8 });
	});

	test('diagnostics describe a row without leaking its traversal shape', () => {
		const described = describeSiteAdapter(douyin, 'www.douyin.com');
		expect(described).toEqual({
			id: 'douyin-speed',
			host: 'www.douyin.com',
			field: 'speed',
			revision: 1,
			status: 'candidate',
			hasProjection: true,
		});
	});
});
