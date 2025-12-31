// goal: Storage Editor type definitions

export interface StorageItem {
	key: string;
	value: string;
	type: 'localStorage' | 'sessionStorage';
	size: number;
}
