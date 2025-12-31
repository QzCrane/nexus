// goal: Permission types and definitions

export interface PermissionDef {
	id: string;
	name: string;
	description: string;
	icon: string;
	category: 'basic' | 'advanced' | 'privacy';
	requiredBy: string[];   // Which features require this permission
}

export interface PermissionState {
	id: string;
	granted: boolean;
}
