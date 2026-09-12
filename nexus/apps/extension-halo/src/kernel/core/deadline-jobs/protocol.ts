// goal: typed command boundary between deadline panels and the background owner

import type { PomodoroCommand } from '../../../tools/pomodoro/core';
import type { TimerCommand } from '../../../tools/timer/core';

export type DeadlineJobCommand =
	| { job: 'timer'; command: TimerCommand }
	| { job: 'pomodoro'; command: PomodoroCommand };

export interface DeadlineCommandMessage {
	type: 'HALO_DEADLINE_COMMAND';
	payload: DeadlineJobCommand;
}

export interface DeadlineCommandResponse {
	success: boolean;
	error?: string;
}

export async function sendDeadlineCommand(payload: DeadlineJobCommand): Promise<void> {
	const message: DeadlineCommandMessage = { type: 'HALO_DEADLINE_COMMAND', payload };
	const response = await chrome.runtime.sendMessage(message) as DeadlineCommandResponse | undefined;
	if (!response?.success) throw new Error(response?.error || 'Deadline command failed');
}
