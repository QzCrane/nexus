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
		createPeer: peerRuntime.createPeer,
	});
	return {
		controller,
		async destroy() {
			await controller.destroy();
			// Sessions own Peer instances; retire those transports before tearing
			// down the shared vendor runtime so close/destroy callbacks still have a
			// live PeerJS implementation to execute against.
			peerRuntime.dispose();
		},
	};
}
