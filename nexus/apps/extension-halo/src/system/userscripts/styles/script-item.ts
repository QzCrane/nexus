// goal: Combined styles for ScriptItem component
// eff: Barrel export of card and control styles

import { cardStyles } from './script-item-card';
import { controlStyles } from './script-item-controls';

export const itemStyles = {
	...cardStyles,
	...controlStyles,
};
