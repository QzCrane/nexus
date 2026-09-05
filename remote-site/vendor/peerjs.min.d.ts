export interface PeerOptions {
	debug?: number;
	host?: string;
	port?: number;
	path?: string;
	key?: string;
	token?: string;
	config?: RTCConfiguration;
	secure?: boolean;
	pingInterval?: number;
	referrerPolicy?: ReferrerPolicy;
}

export interface DataConnection {
	readonly peer: string;
	readonly connectionId: string;
	readonly label: string;
	readonly metadata: unknown;
	readonly reliable: boolean;
	readonly serialization: 'json';
	readonly type: 'data';
	readonly open: boolean;
	peerConnection: RTCPeerConnection | null;
	dataChannel: RTCDataChannel | null;
	on(type: string, listener: (...args: never[]) => void): this;
	off(type: string, listener: (...args: never[]) => void): this;
	close(options?: { flush?: boolean }): void;
	send(data: unknown): boolean;
}

export declare class Peer {
	constructor(id?: string, options?: PeerOptions);
	constructor(options?: PeerOptions);
	readonly id: string | null;
	readonly open: boolean;
	readonly destroyed: boolean;
	readonly disconnected: boolean;
	readonly options: PeerOptions & { config: RTCConfiguration };
	readonly socket: unknown;
	readonly connections: Record<string, DataConnection[]>;
	on(type: 'open', listener: (id: string | null) => void): this;
	on(type: 'connection', listener: (connection: DataConnection) => void): this;
	on(type: 'error', listener: (error: { type: string; message: string }) => void): this;
	on(type: 'disconnected', listener: (id: string | null) => void): this;
	on(type: 'close', listener: () => void): this;
	on(type: string, listener: (...args: never[]) => void): this;
	off(type: string, listener: (...args: never[]) => void): this;
	removeAllListeners(type?: string): this;
	connect(peerId: string, options?: { reliable?: boolean; metadata?: unknown; serialization?: 'json' }): DataConnection | null;
	disconnect(): void;
	reconnect(): void;
	destroy(): void;
}

export declare const PEER_MESSAGE_LIMIT_BYTES: 16384;
export default Peer;
