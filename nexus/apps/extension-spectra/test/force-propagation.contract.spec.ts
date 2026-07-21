import { describe, expect, mock, test } from 'bun:test';
import type { DomainEntry, MediaRoute, SpectraRequestMap } from '@nexus/contracts';
import type { RegistryStoragePort } from '../src/background/registry-repository';
import {
	createSiteEligibilityCache,
	type EligibilityCachePort,
} from '../src/content/logic/policy-executor/eligibility-cache';

// Contract regression guards for the `force?: boolean` propagation path.
// Removing `force` from any layer (protocol payload, storage port, or
// eligibility-cache call site) breaks the user-pinned-correction feature:
// when Capture is acknowledged active, the pinned `direct` route is provably
// wrong and must be overwritten. These tests pin the contract at every layer.

// Type-level assertions: if `force?: boolean` is removed from any payload,
// the corresponding line fails to compile. The runtime tests below exist so
// the runner reports the contract as exercised.
type AssertForce<T extends { force?: boolean }> = T;
type _AddPayloadHasForce = AssertForce<SpectraRequestMap['spectra.registry.add']['payload']>;
type _MarkProbedPayloadHasForce = AssertForce<SpectraRequestMap['spectra.registry.mark-probed']['payload']>;

// Type-level assertion: RegistryStoragePort.add / markProbed must accept an
// options bag carrying `force`. The handler at
// `src/background/handlers/registry.ts` forwards `message.payload.force === true`
// into these methods, so removing the parameter here would break the handler
// call site at compile time.
type AssertOptionsAcceptsForce<T extends (options?: { force?: boolean }) => unknown> = T;
type _AddAcceptsForce = AssertOptionsAcceptsForce<RegistryStoragePort['add']>;
type _MarkProbedAcceptsForce = AssertOptionsAcceptsForce<RegistryStoragePort['markProbed']>;

const siteFingerprint = 'site:media.example';

function entry(
	fingerprint: string,
	route: MediaRoute,
	source: DomainEntry['source'] = 'auto',
): DomainEntry {
	return {
		domain: 'media.example',
		fingerprint,
		route,
		source,
		updatedAt: 1,
	};
}

function port(cached: DomainEntry[] = []): EligibilityCachePort & {
	mark: ReturnType<typeof mock>;
} {
	const stored: DomainEntry[] = cached.map((value) => ({ ...value }));
	return {
		query: mock(async (_domain: string, fingerprint: string) => ({
			entry: stored.find((candidate) => candidate.fingerprint === fingerprint) ?? null,
		})),
		mark: mock(async (
			domain: string,
			fingerprint: string,
			route: MediaRoute,
			options: { force?: boolean } = {},
		): Promise<{ entries: DomainEntry[]; entry: DomainEntry; created: boolean }> => {
			const existing = stored.find((candidate) => candidate.fingerprint === fingerprint);
			if (existing) {
				if (!options.force && existing.source === 'user') {
					return { entries: [...stored], entry: existing, created: false };
				}
				existing.domain = domain;
				existing.source = 'auto';
				existing.route = route;
				existing.updatedAt = 2;
				return { entries: [...stored], entry: existing, created: false };
			}
			const recorded: DomainEntry = { domain, fingerprint, route, source: 'auto', updatedAt: 2 };
			stored.push(recorded);
			return { entries: [...stored], entry: recorded, created: true };
		}),
	};
}

describe('force-propagation contract', () => {
	test('spectra.registry.add payload 接受 force', () => {
		// 类型层面的断言在最上方的 `AssertForce` 别名里;这里只是让测试运行器
		// 把契约标记为已执行,并提供一个运行期 fixture。
		const payload: SpectraRequestMap['spectra.registry.add']['payload'] = {
			domain: 'example.com',
			route: 'capture',
			force: true,
		};
		expect(payload.force).toBe(true);
	});

	test('spectra.registry.mark-probed payload 接受 force', () => {
		const payload: SpectraRequestMap['spectra.registry.mark-probed']['payload'] = {
			domain: 'example.com',
			fingerprint: 'site:example.com',
			route: 'capture',
			force: true,
		};
		expect(payload.force).toBe(true);
	});

	test('force 在省略时默认为 undefined', () => {
		const payload: SpectraRequestMap['spectra.registry.add']['payload'] = {
			domain: 'example.com',
			route: 'capture',
		};
		expect(payload.force).toBeUndefined();
	});

	test('RegistryStoragePort.add 与 markProbed 接受 options.force', () => {
		// 类型层面的断言在最上方的 `AssertOptionsAcceptsForce` 别名里。
		// 这里通过一个最小存根验证接口形状:存根实现必须接受 `{ force: true }`
		// 才能满足 RegistryStoragePort 类型,否则 TypeScript 会拒绝赋值。
		const stub: RegistryStoragePort = {
			get: async () => [],
			query: async () => null,
			add: async (_d, _s, _r, _f, _options) => ({
				success: true,
				entry: entry(siteFingerprint, 'capture'),
			}),
			remove: async () => ({ success: true }),
			markProbed: async (_d, _f, _r, options) => ({
				success: true,
				entry: entry(siteFingerprint, options?.force ? 'capture' : 'direct'),
			}),
		};
		expect(stub).toBeDefined();
	});

	test('eligibility-cache.recordActual("capture", "active") 用 { force: true } 调用 port.mark', async () => {
		// 行为契约: 当 Capture 被确认 active 时,persist 必须以 force=true 调用
		// port.mark,以便覆盖被用户 pin 错的 direct 路由。这是 force 字段在
		// content 侧的唯一调用点,移除它会破坏 user-pin 修正逻辑。
		const cachePort = port([entry(siteFingerprint, 'direct', 'user')]);
		const cache = createSiteEligibilityCache('media.example', cachePort);

		await cache.recordActual('capture', 'active');

		expect(cachePort.mark).toHaveBeenCalledWith(
			'media.example',
			siteFingerprint,
			'capture',
			{ force: true },
		);
	});

	test('eligibility-cache.recordActual("webaudio", "active") 不使用 force', async () => {
		// 对照组: WebAudio 成功不应 force-overwrite 用户 pin 的 Capture,
		// 因此 port.mark 要么不被调用,要么以 force: false/undefined 调用。
		const cachePort = port([entry(siteFingerprint, 'capture', 'user')]);
		const cache = createSiteEligibilityCache('media.example', cachePort);

		await cache.recordActual('webaudio', 'active');

		expect(cachePort.mark).not.toHaveBeenCalled();
	});
});
