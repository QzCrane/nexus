// goal: typed settings failures shared by the repository and its domain projections

import { MAX_SETTINGS_SNAPSHOT_ENTRIES } from '@nexus/contracts';

export class SettingsRevisionConflictError extends Error {
	constructor(readonly currentRevision: number) {
		super(`Settings revision changed to ${currentRevision}`);
		this.name = 'SettingsRevisionConflictError';
	}
}

export class InvalidSettingsPatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidSettingsPatchError';
	}
}

export class SettingsCapacityError extends InvalidSettingsPatchError {
	constructor(
		readonly audioSiteCount: number,
		readonly audioPresetCount: number,
		readonly mediaRouteCount = 0,
	) {
		super(
			`Settings snapshot entry limit exceeded: ${audioSiteCount + audioPresetCount + mediaRouteCount} `
			+ `of ${MAX_SETTINGS_SNAPSHOT_ENTRIES}`,
		);
		this.name = 'SettingsCapacityError';
	}
}
