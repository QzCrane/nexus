// goal: the one shape a bounded collection is allowed to have (INV-12)
//
// Four collections had already grown a ceiling by hand, and all four wrote the
// same three lines: check the size, take the oldest insertion-ordered entry,
// delete it. Four copies of an eviction policy is four chances for one of them
// to be wrong, and there is no way to ask "which collections are bounded?".
//
// The template makes the answer to that question a declaration instead of a
// search: `cap` and `ttlMs` are required members, so a collection cannot be
// introduced without saying how large and how old it may get.

export interface BoundedRegistry<K, V> {
	readonly cap: number;
	readonly ttlMs: number;
	acquire(key: K, make: () => V): V;
	release(key: K): void;
	sweep(now?: number): number;
	readonly size: number;
}

export interface BoundedMap<K, V> extends BoundedRegistry<K, V> {
	get(key: K): V | undefined;
	set(key: K, value: V): void;
	has(key: K): boolean;
	delete(key: K): boolean;
	clear(): void;
	values(): V[];
}

export interface BoundedSet<K> extends BoundedRegistry<K, true> {
	add(key: K): void;
	has(key: K): boolean;
	delete(key: K): boolean;
	clear(): void;
}

export interface BoundedOptions<K, V> {
	readonly cap: number;
	readonly ttlMs: number;
	/**
	 * Called for every entry removed by capacity or age. The four hand-written
	 * evictions all discarded silently; some owners need to release something
	 * when their entry disappears.
	 */
	readonly onEvict?: (key: K, value: V) => void;
}

export function createBoundedMap<K, V>(options: BoundedOptions<K, V>): BoundedMap<K, V> {
	const { cap, ttlMs, onEvict } = options;
	if (!Number.isInteger(cap) || cap <= 0) throw new Error('bounded map requires a positive cap');
	if (!Number.isInteger(ttlMs) || ttlMs < 0) throw new Error('bounded map requires a non-negative ttlMs');

	const entries = new Map<K, { value: V; at: number }>();

	const sweep = (now = Date.now()): number => {
		if (ttlMs <= 0) return 0;
		let removed = 0;
		for (const [key, entry] of [...entries]) {
			if (now - entry.at < ttlMs) continue;
			entries.delete(key);
			onEvict?.(key, entry.value);
			removed += 1;
		}
		return removed;
	};

	const registry: BoundedMap<K, V> = {
		cap,
		ttlMs,
		get size(): number {
			return entries.size;
		},
		get: (key) => entries.get(key)?.value,
		set: (key, value) => {
			// Sweep on write: a collection nobody reads still has to age out, and
			// this is the one moment every owner is guaranteed to reach.
			sweep();
			// Eviction is insertion-ordered, which is what all four hand-written
			// versions relied on: the oldest entry is the least likely to still be
			// in flight. `key` is skipped because it is about to be written.
			while (entries.size >= cap && !entries.has(key)) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined || oldest === key) break;
				const dropped = entries.get(oldest);
				entries.delete(oldest);
				if (dropped) onEvict?.(oldest, dropped.value);
			}
			entries.set(key, { value, at: Date.now() });
		},
		has: (key) => entries.has(key),
		delete: (key) => entries.delete(key),
		clear: () => entries.clear(),
		values: () => [...entries.values()].map((entry) => entry.value),
		acquire: (key, make) => {
			const existing = entries.get(key);
			if (existing) return existing.value;
			const created = make();
			registry.set(key, created);
			return created;
		},
		release: (key) => {
			entries.delete(key);
		},
		sweep,
	};
	return registry;
}

export function createBoundedSet<K>(options: Omit<BoundedOptions<K, true>, 'onEvict'> & { readonly onEvict?: (key: K) => void }): BoundedSet<K> {
	const map = createBoundedMap<K, true>({
		cap: options.cap,
		ttlMs: options.ttlMs,
		...(options.onEvict ? { onEvict: (key: K) => options.onEvict?.(key) } : {}),
	});
	return {
		cap: map.cap,
		ttlMs: map.ttlMs,
		get size(): number {
			return map.size;
		},
		add: (key) => map.set(key, true),
		has: (key) => map.has(key),
		delete: (key) => map.delete(key),
		clear: () => map.clear(),
		acquire: (key) => map.acquire(key, () => true),
		release: (key) => map.release(key),
		sweep: (now?: number) => map.sweep(now),
	};
}
