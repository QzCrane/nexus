// goal: Static data for tool registry
// eff: Aggregated from sub-modules

import type { ToolMeta } from './tool-registry-types';
import { TOOLS_GENERAL } from './tools-data-general';
import { TOOLS_DEV } from './tools-data-dev';
import { TOOLS_EFFICIENCY } from './tools-data-efficiency';
import { TOOLS_VISUAL } from './tools-data-visual';

export const TOOL_REGISTRY: ToolMeta[] = [
	...TOOLS_GENERAL,
	...TOOLS_DEV,
	...TOOLS_EFFICIENCY,
	...TOOLS_VISUAL,
];
