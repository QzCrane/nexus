import { useState } from 'react';
import { useTranslation } from '../../../i18n';
import type { UserScript, EditForm } from '../types';
import {
	addUserScript,
	updateUserScript,
	SCRIPT_TEMPLATES,
} from '../core';
import { useToast } from '../../../components/ToastProvider';

const DEFAULT_FORM: EditForm = {
	name: '',
	description: '',
	code: '',
	matches: '*://*/*',
	excludeMatches: '',
	type: 'javascript',
	runAt: 'document_end',
};

export function useScriptEditor(loadScripts: () => Promise<void>) {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const [showEditor, setShowEditor] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editForm, setEditForm] = useState<EditForm>(DEFAULT_FORM);

	const handleEdit = (script: UserScript) => {
		setEditingId(script.id);
		setEditForm({
			name: script.name,
			description: script.description,
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
			showToast('❌ Name and code required');
			return;
		}
		const scriptData = {
			name: editForm.name.trim(),
			description: editForm.description.trim(),
			code: editForm.code,
			matches: editForm.matches.split(/[,\n]+/).map(m => m.trim()).filter(Boolean),
			excludeMatches: editForm.excludeMatches ? editForm.excludeMatches.split(/[,\n]+/).map(m => m.trim()).filter(Boolean) : undefined,
			type: editForm.type,
			runAt: editForm.runAt,
			enabled: true,
		};

		if (editingId) {
			await updateUserScript(editingId, scriptData);
			showToast(`💾 ${t('userscripts.scriptUpdated')}`);
		} else {
			await addUserScript(scriptData);
			showToast(`✅ ${t('userscripts.scriptAdded')}`);
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
