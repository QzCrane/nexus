// goal: UserScripts panel UI - script management

import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '@nexus/ui-kit';
import { useTranslation } from '../../i18n';
import type { UserScript, UserScriptRunAt } from './types';
import {
	getUserScriptsState,
	addUserScript,
	deleteUserScript,
	toggleUserScript,
	toggleGlobalEnabled,
	SCRIPT_TEMPLATES,
} from './core';
import { injectScriptToCurrentTab } from './engine';
import { styles } from './panel.styles';

export const UserScriptsPanel: React.FC = () => {
	const { t } = useTranslation();
	const [scripts, setScripts] = useState<UserScript[]>([]);
	const [globalEnabled, setGlobalEnabled] = useState(true);
	const [showEditor, setShowEditor] = useState(false);
	const [editForm, setEditForm] = useState({ name: '', description: '', code: '', matches: '*://*/*', runAt: 'document_end' as UserScriptRunAt });

	// Load scripts on mount
	useEffect(() => {
		loadScripts();
	}, []);

	const loadScripts = async () => {
		const state = await getUserScriptsState();
		setScripts(state.scripts);
		setGlobalEnabled(state.globalEnabled);
	};

	// Toggle global
	const handleGlobalToggle = async () => {
		const newState = await toggleGlobalEnabled();
		setGlobalEnabled(newState);
	};

	// Toggle individual script
	const handleToggle = async (id: string) => {
		await toggleUserScript(id);
		await loadScripts();
	};

	// Delete script
	const handleDelete = async (id: string) => {
		await deleteUserScript(id);
		await loadScripts();
	};

	// Test script on current page
	const handleTest = async (script: UserScript) => {
		const success = await injectScriptToCurrentTab(script);
		if (success) alert(`✅ ${script.name} executed!`);
		else alert('❌ Injection failed');
	};

	// Save new script
	const handleSave = async () => {
		if (!editForm.name || !editForm.code) return;
		await addUserScript({
			name: editForm.name,
			description: editForm.description,
			code: editForm.code,
			matches: editForm.matches.split(',').map((m) => m.trim()),
			runAt: editForm.runAt,
			enabled: true,
		});
		setEditForm({ name: '', description: '', code: '', matches: '*://*/*', runAt: 'document_end' });
		setShowEditor(false);
		await loadScripts();
	};

	// Load template
	const loadTemplate = (key: keyof typeof SCRIPT_TEMPLATES) => {
		const tpl = SCRIPT_TEMPLATES[key];
		setEditForm({ name: tpl.name, description: tpl.description, code: tpl.code, matches: tpl.matches.join(', '), runAt: tpl.runAt });
		setShowEditor(true);
	};

	return (
		<div style={styles.wrapper}>
			{/* Global Toggle */}
			<Card variant="default" padding="sm">
				<div style={styles.row}>
					<span style={{ fontSize: '18px' }}>⚡</span>
					<span style={{ flex: 1, fontWeight: 600 }}>{t('userscripts.title')}</span>
					<div
						style={{ ...styles.toggle, background: globalEnabled ? 'var(--halo-accent)' : 'var(--halo-border)' }}
						onClick={handleGlobalToggle}
					>
						<div style={{ ...styles.toggleKnob, left: globalEnabled ? '18px' : '2px' }} />
					</div>
				</div>
			</Card>

			{/* Templates */}
			<div>
				<span style={styles.label}>{t('userscripts.templates')}</span>
				<div style={{ ...styles.row, marginTop: '6px' }}>
					<button style={styles.btnSecondary} onClick={() => loadTemplate('adblock')}>🚫 Ad Block</button>
					<button style={styles.btnSecondary} onClick={() => loadTemplate('darkForce')}>🌙 Dark Mode</button>
					<button style={styles.btnSecondary} onClick={() => loadTemplate('removeOverlay')}>🪟 Remove Overlay</button>
				</div>
			</div>

			{/* Add New / Editor */}
			{showEditor ? (
				<Card variant="default" padding="sm">
					<input style={styles.input} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder={t('userscripts.name')} />
					<input style={{ ...styles.input, marginTop: '6px' }} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} placeholder={t('userscripts.description')} />
					<div style={{ ...styles.row, marginTop: '6px' }}>
						<input style={styles.input} value={editForm.matches} onChange={(e) => setEditForm({ ...editForm, matches: e.target.value })} placeholder="*://*.example.com/*" />
						<select style={styles.select} value={editForm.runAt} onChange={(e) => setEditForm({ ...editForm, runAt: e.target.value as UserScriptRunAt })}>
							<option value="document_start">document_start</option>
							<option value="document_end">document_end</option>
							<option value="document_idle">document_idle</option>
						</select>
					</div>
					<textarea style={{ ...styles.textarea, marginTop: '6px' }} value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} placeholder="// Your JavaScript code here..." />
					<div style={{ ...styles.row, marginTop: '8px' }}>
						<button style={styles.btn} onClick={handleSave}>{t('common.save')}</button>
						<button style={styles.btnSecondary} onClick={() => setShowEditor(false)}>{t('common.cancel')}</button>
					</div>
				</Card>
			) : (
				<button style={styles.btn} onClick={() => setShowEditor(true)}>➕ {t('userscripts.addNew')}</button>
			)}

			{/* Script List */}
			<div>
				<span style={styles.label}>{t('userscripts.myScripts')} ({scripts.length})</span>
			</div>
			{scripts.length === 0 ? (
				<div style={styles.emptyState}>
					<div style={{ fontSize: '32px', marginBottom: '8px' }}>📜</div>
					{t('userscripts.empty')}
				</div>
			) : (
				scripts.map((script) => (
					<div key={script.id} style={styles.scriptCard}>
						<div style={styles.scriptHeader}>
							<span style={styles.scriptTitle}>{script.name}</span>
							<div
								style={{ ...styles.toggle, background: script.enabled ? 'var(--halo-accent)' : 'var(--halo-border)' }}
								onClick={() => handleToggle(script.id)}
							>
								<div style={{ ...styles.toggleKnob, left: script.enabled ? '18px' : '2px' }} />
							</div>
						</div>
						<div style={styles.scriptMeta}>{script.description}</div>
						<div style={styles.scriptMeta}>{script.matches.join(', ')}</div>
						<div style={styles.row}>
							<button style={styles.btnSecondary} onClick={() => handleTest(script)}>▶️ {t('userscripts.test')}</button>
							<button style={styles.btnDanger} onClick={() => handleDelete(script.id)}>🗑️</button>
						</div>
					</div>
				))
			)}
		</div>
	);
};
