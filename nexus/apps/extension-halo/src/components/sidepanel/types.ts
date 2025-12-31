
import type { ToolId } from '../../kernel/types';
import type { HaloSettings } from '../../kernel/settings';
import type { ToolMeta } from '../../kernel/tool-registry';

export interface LayoutProps {
	activeTool: ToolId | null;
	onSelectTool: (id: ToolId) => void;
	onBack: () => void;
	settings: HaloSettings | null;
	onSettingsChange: (s: HaloSettings) => void;
	visibleTools: ToolMeta[];
}
