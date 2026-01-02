// goal: UserScripts panel - full Tampermonkey feature parity
// eff: Master toggle, script list, editor, import/export, templates

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '../../i18n';
import type { UserScript, ScriptType, UserScriptRunAt } from './types';
import {
	getUserScriptsState,
	addUserScript,
	updateUserScript,
	deleteUserScript,
	toggleUserScript,
	toggleGlobalEnabled,
	reorderScript,
	exportScripts,
	importScripts,
	SCRIPT_TEMPLATES,
} from './core';
import { injectScriptToCurrentTab } from './engine';
import { styles } from './panel.styles';
import { ScriptItem, ScriptEditor, ImportExportModal, EmptyState, type EditForm } from './panel-parts';

const DEFAULT_FORM: EditForm = {
	name: '',
	description: '',
	code: '',
	matches: '*://*/*',
	excludeMatches: '',
	type: 'javascript',
	runAt: 'document_end',
};

export const UserScriptsPanel: React.FC = () => {
	const { t } = useTranslation();
	const [scripts, setScripts] = useState<UserScript[]>([]);
	const [globalEnabled, setGlobalEnabled] = useState(true);
	const [showEditor, setShowEditor] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editForm, setEditForm] = useState<EditForm>(DEFAULT_FORM);
	const [modalMode, setModalMode] = useState<'import' | 'export' | null>(null);
	const [exportData, setExportData] = useState('');
	const [toast, setToast] = useState<string | null>(null);

	const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2000); };

	const loadScripts = useCallback(async () => {
		const state = await getUserScriptsState();
		setScripts(state.scripts);
		setGlobalEnabled(state.globalEnabled);
	}, []);

	useEffect(() => { loadScripts(); }, [loadScripts]);

	// Global toggle
	const handleGlobalToggle = async () => {
		const newState = await toggleGlobalEnabled();
		setGlobalEnabled(newState);
		showToast(newState
			? `✅ ${t('userscripts.scriptsEnabled', { defaultValue: 'Scripts enabled' })}`
			: `⏸️ ${t('userscripts.scriptsDisabled', { defaultValue: 'Scripts disabled' })}`);
	};

	// Toggle individual script
	const handleToggle = async (id: string) => {
		await toggleUserScript(id);
		await loadScripts();
	};

	// Delete script
	const handleDelete = async (id: string) => {
		if (!confirm(t('userscripts.deleteConfirm', { defaultValue: 'Delete this script?' }))) return;
		await deleteUserScript(id);
		await loadScripts();
		showToast(`🗑️ ${t('userscripts.scriptDeleted', { defaultValue: 'Script deleted' })}`);
	};

	// Test script
	const handleTest = async (script: UserScript) => {
		const success = await injectScriptToCurrentTab(script);
		showToast(success
			? `✅ ${script.name} ${t('userscripts.executed', { defaultValue: 'executed!' })}`
			: `❌ ${t('userscripts.injectionFailed', { defaultValue: 'Injection failed' })}`);
	};

	// Reorder script
	const handleMove = async (id: string, dir: 'up' | 'down') => {
		await reorderScript(id, dir);
		await loadScripts();
	};

	// Edit script
	const handleEdit = (script: UserScript) => {
		setEditingId(script.id);
		setEditForm({
			name: script.name,
			description: script.description,
			code: script.code,
			matches: script.matches.join(', '),
			excludeMatches: script.excludeMatches?.join(', ') || '',
			type: script.type,
			runAt: script.runAt,
		});
		setShowEditor(true);
	};

	// Save script
	const handleSave = async () => {
		if (!editForm.name.trim() || !editForm.code.trim()) {
			showToast('❌ Name and code required');
			return;
		}

		const scriptData = {
			name: editForm.name.trim(),
			description: editForm.description.trim(),
			code: editForm.code,
			matches: editForm.matches.split(',').map(m => m.trim()).filter(Boolean),
			excludeMatches: editForm.excludeMatches ? editForm.excludeMatches.split(',').map(m => m.trim()).filter(Boolean) : undefined,
			type: editForm.type,
			runAt: editForm.runAt,
			enabled: true,
		};

		if (editingId) {
			await updateUserScript(editingId, scriptData);
			showToast(`💾 ${t('userscripts.scriptUpdated', { defaultValue: 'Script updated' })}`);
		} else {
			await addUserScript(scriptData);
			showToast(`✅ ${t('userscripts.scriptAdded', { defaultValue: 'Script added' })}`);
		}

		setEditForm(DEFAULT_FORM);
		setEditingId(null);
		setShowEditor(false);
		await loadScripts();
	};

	// Cancel edit
	const handleCancel = () => {
		setEditForm(DEFAULT_FORM);
		setEditingId(null);
		setShowEditor(false);
	};

	// Load template
	const loadTemplate = (key: keyof typeof SCRIPT_TEMPLATES) => {
		const tpl = SCRIPT_TEMPLATES[key];
		setEditingId(null);
		setEditForm({
			name: tpl.name,
			description: tpl.description,
			code: tpl.code,
			matches: tpl.matches.join(', '),
			excludeMatches: '',
			type: tpl.type,
			runAt: tpl.runAt,
		});
		setShowEditor(true);
	};

	// Export
	const handleExport = () => {
		setExportData(exportScripts(scripts));
		setModalMode('export');
	};

	// Import
	const handleImport = async (json: string) => {
		try {
			const result = await importScripts(json);
			showToast(`✅ ${t('userscripts.importSuccess', { defaultValue: `Imported ${result.imported} scripts (${result.skipped} skipped)` })}`);
			await loadScripts();
			setModalMode(null);
		} catch (e) {
			showToast(`❌ ${t('userscripts.importFailed', { defaultValue: 'Import failed: Invalid JSON' })}`);
		}
	};

	return (
		<div style={styles.wrapper}>
			{/* Master Toggle */}
			<div style={{ ...styles.masterCard, ...(globalEnabled ? styles.masterCardActive : {}) }}>
				<div>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
						<span style={{ fontSize: '15px', fontWeight: 600 }}>⚡ {t('userscripts.title', { defaultValue: 'User Scripts' })}</span>
						{globalEnabled && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4CAF50', boxShadow: '0 0 6px #4CAF50' }} />}
					</div>
					<div style={{ fontSize: '12px', color: 'var(--halo-text-secondary)', marginTop: '2px' }}>
						{scripts.length} {t('userscripts.scripts', { defaultValue: 'scripts' })} • {scripts.filter(s => s.enabled).length} {t('userscripts.active', { defaultValue: 'active' })}
					</div>
				</div>
				<div style={{ ...styles.toggle, ...(globalEnabled ? styles.toggleActive : {}) }} onClick={handleGlobalToggle}>
					<div style={{ ...styles.toggleKnob, left: globalEnabled ? '18px' : '2px' }} />
				</div>
			</div>

			{/* Action buttons */}
			<div style={styles.btnGroup}>
				<button style={styles.btn} onClick={() => { setEditingId(null); setEditForm(DEFAULT_FORM); setShowEditor(true); }}>➕ {t('userscripts.addNew', { defaultValue: 'Add Script' })}</button>
				<button style={styles.btnSecondary} onClick={handleExport}>📤 {t('userscripts.export', { defaultValue: 'Export' })}</button>
				<button style={styles.btnSecondary} onClick={() => setModalMode('import')}>📥 {t('userscripts.import', { defaultValue: 'Import' })}</button>
			</div>

			{/* Templates */}
			<div>
				<div style={styles.sectionTitle}>📋 {t('userscripts.templates', { defaultValue: 'Templates' })}</div>
				<div style={styles.templatesGrid}>
					{Object.entries(SCRIPT_TEMPLATES).map(([key, tpl]) => {
						// Map template key to i18n key
						const tplNameKey = key === 'adblock' ? 'tplAdblock'
							: key === 'darkForce' ? 'tplDarkForce'
							: key === 'removeOverlay' ? 'tplRemoveOverlay'
							: key === 'customCSS' ? 'tplCustomCSS'
							: 'tplBlockSpace';
						const tplIcon = key === 'adblock' ? '🚫' : key === 'darkForce' ? '🌙' : key === 'removeOverlay' ? '🪟' : key === 'customCSS' ? '🎨' : '⌨️';
						return (
							<button key={key} style={styles.templateBtn} onClick={() => loadTemplate(key as keyof typeof SCRIPT_TEMPLATES)}>
								<span style={styles.templateIcon}>{tplIcon}</span>
								<span style={{ fontSize: '11px' }}>{t(`userscripts.${tplNameKey}`, { defaultValue: tpl.name.split(' ')[0] })}</span>
							</button>
						);
					})}
				</div>
			</div>

			{/* Editor */}
			{showEditor && (
				<ScriptEditor form={editForm} onChange={setEditForm} onSave={handleSave} onCancel={handleCancel} isEdit={!!editingId} t={t} />
			)}

			{/* Script List */}
			<div style={styles.sectionHeader}>
				<span style={styles.sectionTitle}>📜 {t('userscripts.myScripts', { defaultValue: 'My Scripts' })} ({scripts.length})</span>
			</div>

			{scripts.length === 0 ? (
				<EmptyState t={t} />
			) : (
				<div style={styles.scriptList}>
					{scripts.map((script, i) => (
						<ScriptItem
							key={script.id}
							script={script}
							isFirst={i === 0}
							isLast={i === scripts.length - 1}
							onToggle={() => handleToggle(script.id)}
							onEdit={() => handleEdit(script)}
							onDelete={() => handleDelete(script.id)}
							onTest={() => handleTest(script)}
							onMove={(dir) => handleMove(script.id, dir)}
							t={t}
						/>
					))}
				</div>
			)}

			{/* Import/Export Modal - inline rendering */}
			{modalMode && (
				<ImportExportModal mode={modalMode} exportData={exportData} onImport={handleImport} onClose={() => setModalMode(null)} t={t} />
			)}

			{/* Toast */}
			{toast && (
				<div style={{
					position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
					padding: '10px 20px', borderRadius: '8px', background: '#333', color: '#fff',
					fontSize: '13px', zIndex: 1001, boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
				}}>
					{toast}
				</div>
			)}
		</div>
	);
};
