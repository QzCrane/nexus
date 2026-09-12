import { evaluateJsonPath } from './core';
import type { JsonPathRequest, JsonPathResponse } from './worker-contract';

let handled = false;
self.onmessage = (event: MessageEvent<JsonPathRequest>): void => {
	if (handled) return;
	handled = true;
	const response: JsonPathResponse = evaluateJsonPath(event.data.json, event.data.expression);
	self.postMessage(response);
};
