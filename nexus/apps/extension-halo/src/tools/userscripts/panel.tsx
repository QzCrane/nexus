// goal: UserScripts panel - full Tampermonkey feature parity
// eff: Master toggle, script list, editor, import/export, templates

import React from 'react';
import { useTranslation } from '../../i18n';
import { styles } from './styles';
import { ScriptItem } from './components/ScriptItem';
import { ScriptEditor } from './components/ScriptEditor';
import { ImportExportModal } from './components/ImportExportModal';
import { EmptyState } from './components/EmptyState';
import { useUserScripts, useScriptEditor, useImportExport } from './hooks';
import { SCRIPT_TEMPLATES } from './templates';
import { matchesUrl } from './utils';

export const UserScriptsPanel: React.FC = () => {
    const { t } = useTranslation();
    
    const { 
        scripts, globalEnabled, currentUrl, hasPermission, 
        loadScripts, handleRequestPermission, handleGlobalToggle, 
        handleToggle, handleDelete, handleTest, handleMove 
    } = useUserScripts();

    const { 
        showEditor, editingId, editForm, setEditForm, setShowEditor, setEditingId,
        handleEdit, handleSave, handleCancel, loadTemplate 
    } = useScriptEditor(loadScripts);

    const { 
        modalMode, setModalMode, exportData, handleExport, handleImport 
    } = useImportExport(loadScripts);

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
				<button style={styles.btn} onClick={() => { setEditingId(null); setShowEditor(true); }}>➕ {t('userscripts.addNew', { defaultValue: 'Add Script' })}</button>
				<button style={styles.btnSecondary} onClick={() => handleExport(scripts)}>📤 {t('userscripts.export', { defaultValue: 'Export' })}</button>
				<button style={styles.btnSecondary} onClick={() => setModalMode('import')}>📥 {t('userscripts.import', { defaultValue: 'Import' })}</button>
			</div>

			{/* Permission Warning */}
			{!hasPermission && (
				<div style={{
					margin: '10px 15px',
					padding: '10px',
					background: 'var(--halo-warning-muted)',
					border: '1px solid var(--halo-warning)',
					borderRadius: '6px',
					fontSize: '13px',
					display: 'flex',
					flexDirection: 'column',
					gap: '8px'
				}}>
					<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
						<span>⚠️</span>
						<span>{t('userscripts.permsMissing', { defaultValue: 'Permissions needed for auto-injection' })}</span>
					</div>
					<button 
						style={{ ...styles.btn, fontSize: '12px', padding: '6px' }}
						onClick={handleRequestPermission}
					>
						{t('userscripts.enableAuto', { defaultValue: 'Enable Auto-Run' })}
					</button>
				</div>
			)}

			{/* Templates */}
			{!showEditor && (
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
			)}

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
							isActive={hasPermission && currentUrl && globalEnabled ? (matchesUrl(script.matches, currentUrl) && (!script.excludeMatches || !matchesUrl(script.excludeMatches, currentUrl))) : false}
							t={t}
						/>
					))}
				</div>
			)}

			{/* Import/Export Modal - inline rendering */}
			{modalMode && (
				<ImportExportModal mode={modalMode} exportData={exportData} onImport={handleImport} onClose={() => setModalMode(null)} t={t} />
			)}
		</div>
	);
};
