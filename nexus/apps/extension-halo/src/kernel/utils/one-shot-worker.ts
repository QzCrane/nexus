import type { OwnedTaskExecution } from './owned-async-task';

export interface OneShotWorkerLike {
	onmessage: Worker['onmessage'];
	onerror: Worker['onerror'];
	onmessageerror: Worker['onmessageerror'];
	postMessage(message: unknown, transfer?: Transferable[]): void;
	terminate(): void;
}

export function oneShotWorker<Request, Response>(
	createWorker: () => OneShotWorkerLike,
	request: Request,
	transfer: Transferable[] = [],
): OwnedTaskExecution<Response> {
	const worker = createWorker();
	let settled = false;
	let resolvePromise!: (value: Response) => void;
	let rejectPromise!: (error: unknown) => void;
	const promise = new Promise<Response>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	const dispose = (): void => {
		if (settled) return;
		settled = true;
		worker.terminate();
	};
	worker.onmessage = (event) => {
		if (settled) return;
		settled = true;
		worker.terminate();
		resolvePromise(event.data as Response);
	};
	worker.onerror = (event) => {
		if (settled) return;
		settled = true;
		worker.terminate();
		rejectPromise(event.error ?? new Error(event.message || 'Worker execution failed'));
	};
	worker.onmessageerror = () => {
		if (settled) return;
		settled = true;
		worker.terminate();
		rejectPromise(new Error('Worker returned an unreadable message'));
	};
	try {
		worker.postMessage(request, transfer);
	} catch (error) {
		dispose();
		rejectPromise(error);
	}
	return { promise, dispose };
}

export function extensionWorkerFactory(path: string): () => Worker {
	return () => new Worker(chrome.runtime.getURL(path), { type: 'module' });
}
