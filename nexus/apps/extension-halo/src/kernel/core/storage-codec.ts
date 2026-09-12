// goal: persistence result contract; each domain owns its field validation

export type ToolStateDecode<T> =
	| { readonly kind: 'valid'; readonly value: T }
	| { readonly kind: 'invalid'; readonly reason: string };

export interface ToolStateCodec<T> {
	decode(value: unknown): ToolStateDecode<T>;
	encode(value: T): unknown;
}

export interface ToolStateRecovery<T> {
	readonly invalid: null | { readonly raw: unknown; readonly reason: string };
	readonly persistence: 'loading' | 'saving' | 'saved' | 'failed' | 'unknown' | 'invalid';
	readonly lastConfirmedRevision: number | null;
	/** Explicitly replace invalid persisted data with a domain-approved value. */
	replaceInvalid(value: T): void;
}
