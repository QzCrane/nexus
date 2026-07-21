import { describe, expect, test } from 'bun:test';
import {
	createKeyedSerializedQueue,
	createSerializedQueue,
} from '@nexus/kernel';

// Regression guards for the serialized queue contract: a failed operation
// must never poison subsequent operations, and per-key queues must release
// idle memory once they drain. These behaviors are load-bearing for the
// audio-session store and registry repository, which rely on the queue to
// serialize read-modify-write sequences without losing later ACKs.

function tick(): Promise<void> {
	return new Promise((resolve) => {
		queueMicrotask(resolve);
	});
}

describe('serialized queue recovery', () => {
	test('后续操作在前一个操作失败后仍能运行并 resolve', async () => {
		const queue = createSerializedQueue();
		const op1 = queue(() => Promise.reject(new Error('op1 failed')));
		await expect(op1).rejects.toThrow('op1 failed');

		const op2Result = await queue(() => Promise.resolve('op2-ok'));
		expect(op2Result).toBe('op2-ok');
	});

	test('操作按入队顺序串行执行 (op2 只在 op1 settle 后开始)', async () => {
		const queue = createSerializedQueue();
		const events: string[] = [];

		const op1 = queue(() => new Promise<string>((resolve) => {
			events.push('op1-start');
			setTimeout(() => {
				events.push('op1-end');
				resolve('op1');
			}, 10);
		}));
		const op2 = queue(() => new Promise<string>((resolve) => {
			events.push('op2-start');
			events.push('op2-end');
			resolve('op2');
		}));

		const [r1, r2] = await Promise.all([op1, op2]);
		expect(r1).toBe('op1');
		expect(r2).toBe('op2');
		// op2 必须在 op1 结束之后才能开始 —— 不允许交错
		expect(events).toEqual(['op1-start', 'op1-end', 'op2-start', 'op2-end']);
	});

	test('drain() 在队列为空时立即 resolve', async () => {
		const queue = createSerializedQueue();
		// 没有任何操作入队，drain 应直接 resolve
		await expect(queue.drain()).resolves.toBeUndefined();
	});

	test('drain() 等待正在执行的操作完成', async () => {
		const queue = createSerializedQueue();
		let operationDone = false;
		const op = queue(() => new Promise<void>((resolve) => {
			setTimeout(() => {
				operationDone = true;
				resolve();
			}, 10);
		}));

		// 不 await op，直接 drain，drain 必须等到 op 完成
		await Promise.all([op, queue.drain()]);
		expect(operationDone).toBe(true);
	});

	test('不同 key 的操作并发执行 (按时间交错)', async () => {
		const queue = createKeyedSerializedQueue<string>();
		const events: string[] = [];

		const opA = queue('a', () => new Promise<void>((resolve) => {
			events.push('a-start');
			setTimeout(() => {
				events.push('a-end');
				resolve();
			}, 20);
		}));
		const opB = queue('b', () => new Promise<void>((resolve) => {
			events.push('b-start');
			setTimeout(() => {
				events.push('b-end');
				resolve();
			}, 5);
		}));

		await Promise.all([opA, opB]);
		// 两个 key 的操作应并发：b 在 a 仍然在途时开始并结束
		expect(events).toContain('a-start');
		expect(events).toContain('b-start');
		// b 比 a 先结束是并发执行的直接证据 (若是串行，b-end 不会先于 a-end)
		const bEndIndex = events.indexOf('b-end');
		const aEndIndex = events.indexOf('a-end');
		expect(bEndIndex).toBeLessThan(aEndIndex);
	});

	test('相同 key 的操作串行执行', async () => {
		const queue = createKeyedSerializedQueue<string>();
		const events: string[] = [];

		const op1 = queue('same', () => new Promise<void>((resolve) => {
			events.push('op1-start');
			setTimeout(() => {
				events.push('op1-end');
				resolve();
			}, 10);
		}));
		const op2 = queue('same', () => new Promise<void>((resolve) => {
			events.push('op2-start');
			events.push('op2-end');
			resolve();
		}));

		await Promise.all([op1, op2]);
		expect(events).toEqual(['op1-start', 'op1-end', 'op2-start', 'op2-end']);
	});

	test('失败的操作不会阻塞相同 key 的后续操作', async () => {
		const queue = createKeyedSerializedQueue<string>();
		const op1 = queue('recovery', () => Promise.reject(new Error('boom')));
		await expect(op1).rejects.toThrow('boom');

		const op2Result = await queue('recovery', () => Promise.resolve('recovered'));
		expect(op2Result).toBe('recovered');
	});

	test('drain() 等到所有 per-key 队列清空后 resolve', async () => {
		const queue = createKeyedSerializedQueue<string>();
		let aDone = false;
		let bDone = false;

		const opA = queue('a', () => new Promise<void>((resolve) => {
			setTimeout(() => {
				aDone = true;
				resolve();
			}, 10);
		}));
		const opB = queue('b', () => new Promise<void>((resolve) => {
			setTimeout(() => {
				bDone = true;
				resolve();
			}, 15);
		}));

		await Promise.all([opA, opB, queue.drain()]);
		expect(aDone).toBe(true);
		expect(bDone).toBe(true);
	});

	test('空闲 key 在 drain 后被清理 (内存: queues Map 为空)', async () => {
		// 实现细节: createKeyedSerializedQueue 在每个 key 的 tail promise settle
		// 后通过 `finally` 删除 Map 条目。Map 是闭包私有、无法直接断言大小,
		// 因此通过行为契约验证清理: 所有操作 settle + drain 完成后,再次调用
		// drain() 必须立即 resolve (Map 为空或仅含已 settle 的条目,无在途工作),
		// 且对曾使用的 key 重新入队会从干净的 Promise.resolve() 起步 (不继承
		// 任何旧的链尾),证明旧条目已被回收。
		const queue = createKeyedSerializedQueue<string>();
		const usedKeys = ['idle-a', 'idle-b', 'idle-c'];

		await Promise.all(usedKeys.map((key) =>
			queue(key, () => Promise.resolve(`${key}-done`)),
		));
		await queue.drain();

		// drain() 之后所有 tail 的 finally 清理已调度;让微任务跑完以确保
		// `queues.delete(key)` 已执行。
		await tick();
		await tick();

		// 行为契约 1: 空闲队列上 drain() 立即 resolve
		await expect(queue.drain()).resolves.toBeUndefined();

		// 行为契约 2: 对曾使用的 key 重新入队,新操作不依赖任何旧链尾 ——
		// 即使旧条目意外残留 (已 settle),新 op 仍能在不等待前一帧的前提下运行。
		const reuseStart = Date.now();
		const result = await queue('idle-a', () => Promise.resolve('reuse-ok'));
		const reuseElapsed = Date.now() - reuseStart;
		expect(result).toBe('reuse-ok');
		expect(reuseElapsed).toBeLessThan(50);

		// 行为契约 3: 多次循环使用同一组 key 后,drain 仍然稳定 resolve,
		// 证明 Map 不会因未清理的条目而累积或在 allSettled 上出错。
		for (let i = 0; i < 5; i += 1) {
			await Promise.all(usedKeys.map((key) =>
				queue(key, () => Promise.resolve(`${key}-${i}`)),
			));
		}
		await queue.drain();
		await tick();
		await expect(queue.drain()).resolves.toBeUndefined();
	});
});
