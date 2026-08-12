import { useState, useCallback } from 'react';
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
	category: 'general',
	code: '',
	matches: '*://*/*',
	excludeMatches: '',
	type: 'javascript',
	runAt: 'document_end',
};

export function useScriptEditor() {
	const { t } = useTranslation();
	const { showToast } = useToast();
	const [showEditor, setShowEditor] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editForm, setEditForm] = useState<EditForm>(DEFAULT_FORM);

	const handleEdit = useCallback((script: UserScript) => {
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
	}, []);

	const handleSave = useCallback(async () => {
		if (!editForm.name.trim() || !editForm.code.trim()) {
			showToast('❌ Name and code required');
			return;
		}
		const matches = editForm.matches.split(/[,\n]+/).map((match) => match.trim()).filter(Boolean);
		if (matches.length === 0) {
			showToast('❌ At least one match pattern is required');
			return;
		}
		const scriptData = {
			name: editForm.name.trim(),
			description: editForm.description.trim(),
			category: editForm.category,
			code: editForm.code,
			matches,
			excludeMatches: editForm.excludeMatches
				? editForm.excludeMatches.split(/[,\n]+/).map((match) => match.trim()).filter(Boolean)
				: undefined,
			type: editForm.type,
			runAt: editForm.runAt,
			enabled: true,
		};

		if (editingId && !editingId.startsWith('saat-')) {
			await updateUserScript(editingId, scriptData);
			showToast(`💾 ${t('userscripts.scriptUpdated')}`);
		} else {
			await addUserScript(scriptData);
			if (editingId?.startsWith('saat-')) {
				showToast(`📋 ${t('userscripts.scriptForked', { defaultValue: 'Script forked as new' })}`);
			} else {
				showToast(`✅ ${t('userscripts.scriptAdded')}`);
			}
		}

		setEditForm(DEFAULT_FORM);
		setEditingId(null);
		setShowEditor(false);
	}, [editForm, editingId, showToast, t]);

	const handleCancel = useCallback(() => {
		setEditForm(DEFAULT_FORM);
		setEditingId(null);
		setShowEditor(false);
	}, []);

	const loadTemplate = useCallback((key: keyof typeof SCRIPT_TEMPLATES) => {
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
	}, []);

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
		loadTemplate,
	};
}
