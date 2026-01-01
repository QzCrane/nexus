
import type { ToolId, HaloSettings, ToolMeta } from '../../kernel';

export interface LayoutProps {
	activeTool: ToolId | null;
	onSelectTool: (id: ToolId) => void;
	onBack: () => void;
	settings: HaloSettings | null;
	onSettingsChange: (s: HaloSettings) => void;
	visibleTools: ToolMeta[];
	openTools: ToolId[];
	onCloseTool: (id: ToolId) => void;
	onTogglePin: (id: string) => void;
	onReorderTools: (category: string, ids: string[]) => void;
}
