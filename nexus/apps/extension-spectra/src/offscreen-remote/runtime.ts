// goal: owns the Remote-only lazy controller and its local PeerJS loader

import type { RemoteHostController } from './remote-host';
import { createRemoteHostController } from './remote-host';
import { createPeerRuntimeLoader } from './peerjs-loader';

export interface OffscreenRemoteRuntime {
	controller: RemoteHostController;
	destroy(): Promise<void>;
}

export function createOffscreenRemoteRuntime(): OffscreenRemoteRuntime {
	const peerRuntime = createPeerRuntimeLoader();
	const controller = createRemoteHostController({
		ensurePeerRuntime: peerRuntime.ensure,
	});
	return {
		controller,
		async destroy() {
			peerRuntime.dispose();
			await controller.destroy();
		},
	};
}
