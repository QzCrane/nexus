// goal: UUID tool type definitions

export type UUIDVersion = 'v1' | 'v4' | 'v7' | 'ULID';

export const UUID_VERSIONS: UUIDVersion[] = ['v1', 'v4', 'v7', 'ULID'];

export interface UUIDState {
	version: UUIDVersion;
	count: number;
	generated: string[];
	uppercase: boolean;
	hyphens: boolean;
}
