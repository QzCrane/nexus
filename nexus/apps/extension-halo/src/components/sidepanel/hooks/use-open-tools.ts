// goal: Open tools state management hook
// eff: Persist one current SidePanel navigation authority without stale async replay

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ToolId } from '../../../kernel';
import { STORAGE_PREFIX, TOOL_REGISTRY } from '../../../kernel';
import { conditionalLedgerWrite, readLedgerEntry } from '../../../kernel/core/safe-storage';
import { reportStorageHealth } from '../../../kernel/core/storage-health';

const SYSTEM_TOOL_IDS = new Set<string>(
	TOOL_REGISTRY.filter((tool) => tool.pluginType === 'system').map((tool) => tool.id),
);
const KNOWN_TOOL_IDS = new Set<string>(TOOL_REGISTRY.map((tool) => tool.id));

const isSystemTool = (id: string): boolean => SYSTEM_TOOL_IDS.has(id);
const isKnownTool = (id: unknown): id is ToolId => typeof id === 'string' && KNOWN_TOOL_IDS.has(id);

const OPEN_TOOLS_KEY = `${STORAGE_PREFIX.CORE}open_tools`;
const ACTIVE_TOOL_KEY = `${STORAGE_PREFIX.CORE}active_tool`;
const MAX_OPEN_TOOLS = 10;
const storageHealthOwner = Symbol('open-tools');

function sameTools(left: readonly ToolId[], right: readonly ToolId[]): boolean {
	return left.length === right.length && left.every((id, index) => right[index] === id);
}

export interface UseOpenToolsResult {
	activeTool: ToolId | null;
	openTools: ToolId[];
	setActiveTool: (toolId: ToolId | null) => void;
	handleToolSelect: (toolId: ToolId) => Promise<void>;
	handleCloseTool: (toolId: ToolId) => void;
	handleBack: () => Promise<void>;
	loadOpenTools: (isEnabled: (id: string) => boolean) => Promise<void>;
}

export function useOpenTools(): UseOpenToolsResult {
	const [activeTool, setActiveToolState] = useState<ToolId | null>(null);
	const [openTools, setOpenTools] = useState<ToolId[]>([]);
	const initialized = useRef(false);
	const authorityEpoch = useRef(0);

	const persistOpenTools = useCallback((nextOpen: readonly ToolId[]): void => {
		void (async () => {
			const base = await readLedgerEntry(OPEN_TOOLS_KEY, { area: 'local' });
			const value = [...nextOpen];
			const outcome = await conditionalLedgerWrite(OPEN_TOOLS_KEY, { area: 'local', baseRevision: base.revision, value, remerge: () => value });
			if (outcome.kind !== 'committed') throw new Error('Open tools were not committed');
			reportStorageHealth(storageHealthOwner, null);
		})().catch((error) => { reportStorageHealth(storageHealthOwner, 'write-error'); console.warn('openTools persist failed', error); });
	}, []);

	const claimLocalAuthority = useCallback((): void => {
		authorityEpoch.current += 1;
		initialized.current = true;
	}, []);

	useEffect(() => {
		if (!initialized.current) return;
		const value = activeTool === null ? 'HALO_LAUNCHER' : activeTool;
		void (async () => {
			const base = await readLedgerEntry(ACTIVE_TOOL_KEY, { area: 'local' });
			const outcome = await conditionalLedgerWrite(ACTIVE_TOOL_KEY, { area: 'local', baseRevision: base.revision, value, remerge: () => value });
			if (outcome.kind !== 'committed') throw new Error('Active tool was not committed');
			reportStorageHealth(storageHealthOwner, null);
		})().catch((error) => { reportStorageHealth(storageHealthOwner, 'write-error'); console.warn('openTools persist failed', error); });
	}, [activeTool]);

	const setActiveTool = useCallback((toolId: ToolId | null) => {
		claimLocalAuthority();
		setActiveToolState(toolId);
	}, [claimLocalAuthority]);

	const reconcileEnabledTools = useCallback((isEnabled: (id: string) => boolean): void => {
		if (!initialized.current) return;
		setOpenTools((current) => {
			const next = current.filter((id) => isEnabled(id));
			if (sameTools(current, next)) return current;
			persistOpenTools(next);
			return next;
		});
		setActiveToolState((current) => (
			current === null || isEnabled(current) ? current : null
		));
	}, [persistOpenTools]);

	const loadOpenTools = useCallback(async (isEnabled: (id: string) => boolean) => {
		if (initialized.current) {
			reconcileEnabledTools(isEnabled);
			return;
		}

		const epoch = ++authorityEpoch.current;
		const [activeEntry, openEntry] = await Promise.all([
			readLedgerEntry(ACTIVE_TOOL_KEY, { area: 'local' }),
			readLedgerEntry(OPEN_TOOLS_KEY, { area: 'local' }),
		]);
		if (epoch !== authorityEpoch.current || initialized.current) return;

		const rawOpen = Array.isArray(openEntry.value)
			? openEntry.value.filter(isKnownTool)
			: [];
		const savedOpen = rawOpen.filter((id) => !isSystemTool(id) && isEnabled(id));
		const savedActive = activeEntry.value;
		const restoredActive = savedActive === 'HALO_LAUNCHER'
			? null
			: isKnownTool(savedActive) && isEnabled(savedActive)
				? savedActive
				: null;

		initialized.current = true;
		setOpenTools(savedOpen);
		setActiveToolState(restoredActive);
		if (!sameTools(rawOpen, savedOpen)) persistOpenTools(savedOpen);
	}, [persistOpenTools, reconcileEnabledTools]);

	const handleToolSelect = useCallback(async (toolId: ToolId) => {
		claimLocalAuthority();
		setActiveToolState(toolId);
		if (!isSystemTool(toolId)) {
			setOpenTools((previous) => {
				if (previous.includes(toolId)) return previous;
				const next = previous.length >= MAX_OPEN_TOOLS
					? [...previous.slice(1), toolId]
					: [...previous, toolId];
				persistOpenTools(next);
				return next;
			});
		}
	}, [claimLocalAuthority, persistOpenTools]);

	const handleCloseTool = useCallback((toolId: ToolId) => {
		claimLocalAuthority();
		setOpenTools((previous) => {
			const next = previous.filter((id) => id !== toolId);
			setActiveToolState((current) => {
				if (current !== toolId) return current;
				return [...next].reverse().find((id) => !isSystemTool(id)) ?? null;
			});
			persistOpenTools(next);
			return next;
		});
	}, [claimLocalAuthority, persistOpenTools]);

	const handleBack = useCallback(async () => {
		claimLocalAuthority();
		setActiveToolState(null);
	}, [claimLocalAuthority]);

	return {
		activeTool,
		openTools,
		setActiveTool,
		handleToolSelect,
		handleCloseTool,
		handleBack,
		loadOpenTools,
	};
}
