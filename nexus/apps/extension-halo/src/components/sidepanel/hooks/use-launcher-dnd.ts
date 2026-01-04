// goal: Launcher drag and drop hook
// eff: Handles tool and category reordering with temporary state

import { useState } from 'react';
import type { ToolMeta } from '../../../kernel';

interface UseLauncherDnDProps {
	categorizedTools: Record<string, ToolMeta[]>;
	catOrder: string[];
	onReorderTools: (category: string, ids: string[]) => void;
	onReorderCategories: (ids: string[]) => void;
}

export function useLauncherDnD({
	categorizedTools,
	catOrder,
	onReorderTools,
	onReorderCategories
}: UseLauncherDnDProps) {
	const [draggingId, setDraggingId] = useState<string | null>(null);
	const [draggingCat, setDraggingCat] = useState<string | null>(null);
	const [tempCats, setTempCats] = useState<Record<string, ToolMeta[]> | null>(null);
	const [tempCatOrder, setTempCatOrder] = useState<string[] | null>(null);

	const onDragStart = (e: React.DragEvent, id: string) => {
		setDraggingId(id);
		e.dataTransfer.setData('toolId', id);
	};

	const onCatDragStart = (e: React.DragEvent, cat: string) => {
		setDraggingCat(cat);
		e.dataTransfer.setData('catId', cat);
	};

	const onDragEnter = (cat: string, targetId: string) => {
		if (!draggingId || draggingId === targetId) return;
		const current = categorizedTools[cat];
		const oldIdx = current.findIndex(t => t.id === draggingId);
		const newIdx = current.findIndex(t => t.id === targetId);

		if (oldIdx !== -1 && newIdx !== -1) {
			const newList = [...current];
			const [item] = newList.splice(oldIdx, 1);
			newList.splice(newIdx, 0, item);
			setTempCats({ ...categorizedTools, [cat]: newList });
		}
	};

	const onCatDragEnter = (targetCat: string) => {
		if (!draggingCat || draggingCat === targetCat) return;
		const oldIdx = catOrder.indexOf(draggingCat);
		const newIdx = catOrder.indexOf(targetCat);

		if (oldIdx !== -1 && newIdx !== -1) {
			const newOrder = [...catOrder];
			const [item] = newOrder.splice(oldIdx, 1);
			newOrder.splice(newIdx, 0, item);
			setTempCatOrder(newOrder);
		}
	};

	const onDrop = (e: React.DragEvent, cat: string) => {
		e.preventDefault();
		if (tempCats) onReorderTools(cat, tempCats[cat].map(t => t.id));
		setDraggingId(null);
		setTempCats(null);
	};

	const onCatDrop = (e: React.DragEvent) => {
		e.preventDefault();
		if (tempCatOrder) onReorderCategories(tempCatOrder);
		setDraggingCat(null);
		setTempCatOrder(null);
	};

	return {
		draggingId,
		draggingCat,
		tempCats,
		tempCatOrder,
		onDragStart,
		onCatDragStart,
		onDragEnter,
		onCatDragEnter,
		onDrop,
		onCatDrop
	};
}
