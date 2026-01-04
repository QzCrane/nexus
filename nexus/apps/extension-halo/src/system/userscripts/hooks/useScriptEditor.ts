import { useState } from 'react';
import { useTranslation } from '../../../i18n';
import type { UserScript, EditForm } from '../types';
import {
	addUserScript,
	updateUserScript,
	SCRIPT_TEMPLATES,
} from '../core';
import { useOverlay } from '../../../components/ui';

const DEFAULT_FORM: EditForm = {
	name: '',
	description: '',
	category: 'general',
	code: '',
	matches: '*://*/*',
	excludeMatches: '',
	type: 'javascript',
	runAt: 'document_end',
};

export function useScriptEditor(loadScripts: () => Promise<void>) {
	const { t } = useTranslation();
	const { showToast } = useOverlay();
	const [showEditor, setShowEditor] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editForm, setEditForm] = useState<EditForm>(DEFAULT_FORM);

	const handleEdit = (script: UserScript) => {
		setEditingId(script.id);
		setEditForm({
			name: script.name,
			description: script.description,
			category: script.category || 'general',
			code: script.code,
			matches: script.matches.join('\n'),
			excludeMatches: script.excludeMatches?.join('\n') || '',
			type: script.type,
			runAt: script.runAt,
		});
		setShowEditor(true);
	};

	const handleSave = async () => {
		if (!editForm.name.trim() || !editForm.code.trim()) {
			showToast({ message: '❌ Name and code required' });
			return;
		}
		const scriptData = {
			name: editForm.name.trim(),
			description: editForm.description.trim(),
			category: editForm.category,
			code: editForm.code,
			matches: editForm.matches.split(/[,\n]+/).map(m => m.trim()).filter(Boolean),
			excludeMatches: editForm.excludeMatches ? editForm.excludeMatches.split(/[,\n]+/).map(m => m.trim()).filter(Boolean) : undefined,
			type: editForm.type,
			runAt: editForm.runAt,
			enabled: true,
		};

		if (editingId && !editingId.startsWith('saat-')) {
			// Normal update for user scripts
			await updateUserScript(editingId, scriptData);
			showToast({ message: `💾 ${t('userscripts.scriptUpdated')}` });
		} else {
			// Create new script (or Fork from SaaT)
			// If it was a SaaT script (editingId starts with 'saat-'), we are effectively forking it
			await addUserScript(scriptData);
			if (editingId && editingId.startsWith('saat-')) {
				showToast({ message: `📋 ${t('userscripts.scriptForked', { defaultValue: 'Script forked as new' })}` });
			} else {
				showToast({ message: `✅ ${t('userscripts.scriptAdded')}` });
			}
		}

		setEditForm(DEFAULT_FORM);
		setEditingId(null);
		setShowEditor(false);
		await loadScripts();
	};

	const handleCancel = () => {
		setEditForm(DEFAULT_FORM);
		setEditingId(null);
		setShowEditor(false);
	};

	const loadTemplate = (key: keyof typeof SCRIPT_TEMPLATES) => {
		const tpl = SCRIPT_TEMPLATES[key];
		setEditingId(null);
		setEditForm({
			name: tpl.name,
			description: tpl.description,
			category: 'general',
			code: tpl.code,
			matches: tpl.matches.join('\n'),
			excludeMatches: '',
			type: tpl.type,
			runAt: tpl.runAt,
		});
		setShowEditor(true);
	};

	return {
		showEditor,
		editingId,
		editForm,
		setEditForm,
		setShowEditor,
		setEditingId,
		handleEdit,
		handleSave,
		handleCancel,
		loadTemplate
	};
}
