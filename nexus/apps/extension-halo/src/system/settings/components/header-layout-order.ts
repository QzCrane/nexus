// goal: Immutable header shortcut ordering shared by pointer and keyboard controls
// inv: Reordering never mutates the persisted source layout

export type HeaderLayoutMove = -1 | 1 | 'first' | 'last';

export function moveHeaderLayoutItem(
	layout: readonly string[],
	id: string,
	move: HeaderLayoutMove,
): string[] | null {
	const currentIndex = layout.indexOf(id);
	if (currentIndex === -1) return null;
	const targetIndex = move === 'first'
		? 0
		: move === 'last'
			? layout.length - 1
			: Math.min(layout.length - 1, Math.max(0, currentIndex + move));
	if (targetIndex === currentIndex) return null;

	const next = [...layout];
	next.splice(currentIndex, 1);
	next.splice(targetIndex, 0, id);
	return next;
}
