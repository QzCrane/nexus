// goal: UserScripts panel - full Tampermonkey feature parity
// eff: Master toggle, script list, editor page, import/export, templates, unified horizontal slide

import React, { useEffect } from 'react';
import { useOverlay } from '../../components/ui/overlay';
import { SlidePage } from '../../components/ui/animated-transition';
import { useTranslation } from '../../i18n';
import { styles } from './styles';
import { ScriptItem } from './components/ScriptItem';
import { ScriptEditorPage } from './components/ScriptEditorPage';
import { ImportExportModal } from './components/ImportExportModal';
import { SettingsModal } from './components/SettingsModal';
import { EmptyState } from './components/EmptyState';
import { useUserScripts, useScriptEditor, useImportExport } from './hooks';
import { UserscriptsToolbar } from './components/toolbar';
import { UserscriptsTemplates } from './components/templates';
import { matchesUrl } from './utils';

export const UserScriptsPanel: React.FC = () => {
	const { t } = useTranslation();
	
	const {
		scripts, globalEnabled, currentUrl, hasPermission, 
		loadScripts, handleRequestPermission, handleGlobalToggle, 
		handleToggle, handleDelete, handleTest, handleMove,
		toolbarConfig, handleToolbarConfig
	} = useUserScripts();

	const {
		showEditor, editingId, editForm, setEditForm, setShowEditor, setEditingId,
		handleEdit, handleSave, handleCancel, loadTemplate 
	} = useScriptEditor(loadScripts);

	const { 
		modalMode, setModalMode, exportData, handleExport, handleImport 
	} = useImportExport(loadScripts);

	const overlay = useOverlay();

	// Sync modalMode with Overlay
	useEffect(() => {
		if (modalMode) {
			overlay.showModal({
				title: modalMode === 'export' 
					? `📤 ${t('userscripts.exportTitle', { defaultValue: 'Export Scripts' })}`
					: `📥 ${t('userscripts.importTitle', { defaultValue: 'Import Scripts' })}`,
				message: '',
				hideFooter: true,
				content: (
					<ImportExportModal 
						mode={modalMode} 
						exportData={exportData} 
						onImport={(json) => { handleImport(json); overlay.closeModal(); setModalMode(null); }}
						onClose={() => { overlay.closeModal(); setModalMode(null); }} 
						t={t}
					/>
				),
				onCancel: () => setModalMode(null)
			});
		}
	}, [modalMode, exportData]);

	// Check if we were redirected here to edit a specific script
	useEffect(() => {
		const scriptId = sessionStorage.getItem('halo_edit_script');
		if (!scriptId || scripts.length === 0) return;
		
		sessionStorage.removeItem('halo_edit_script');
		
		const targetScript = scripts.find(s => 
			s.id === scriptId || 
			s.name === scriptId || 
			(s as any).saatToolId === scriptId
		);
		
		if (targetScript) {
			handleEdit(targetScript);
		}
	}, [scripts, handleEdit]);

	// Unified container with horizontal slide transitions
	return (
		<div style={{
			// Break out of ToolPanelRenderer's 12px padding for full-bleed transitions
			margin: '-12px -12px 0 -12px',
			width: 'calc(100% + 24px)',
			height: 'calc(100% + 12px)',
			display: 'flex',
			flexDirection: 'column',
			background: 'var(--halo-bg)',
			overflow: 'hidden',
			position: 'relative',
		}}>
			{/* List Page - base layer */}
			<SlidePage
				show={true}
				direction="right"
				keepMounted={true}
				style={{
					display: 'flex',
					flexDirection: 'column',
					overflowY: 'auto',
					padding: '12px 12px 0 12px',
					boxSizing: 'border-box',
				}}
			>
				<div style={styles.wrapper}>
					{/* Master Toggle & Settings */}
					<div style={{ ...styles.masterCard, ...(globalEnabled ? styles.masterCardActive : {}), flexDirection: 'row', justifyContent: 'space-between', paddingRight: '12px' }}>
						<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
							<div onClick={handleGlobalToggle} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
								<div style={{ ...styles.toggle, ...(globalEnabled ? styles.toggleActive : {}) }}>
									<div style={{ ...styles.toggleKnob, left: globalEnabled ? '18px' : '2px' }} />
								</div>
								<div>
									<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
										<span style={{ fontSize: '15px', fontWeight: 600 }}>⚡ {t('userscripts.title', { defaultValue: 'User Scripts' })}</span>
										{/* globalEnabled && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4CAF50', boxShadow: '0 0 6px #4CAF50' }} /> */}
									</div>
									<div style={{ fontSize: '12px', color: 'var(--halo-text-secondary)', marginTop: '2px' }}>
										{scripts.length} {t('userscripts.scripts', { defaultValue: 'scripts' })} • {scripts.filter(s => s.enabled).length} {t('userscripts.active', { defaultValue: 'active' })}
									</div>
								</div>
							</div>
						</div>
						
						{/* Settings Icon */}
						<button 
							style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '4px', opacity: 0.7 }}
							onClick={() => {
								overlay.showModal({
									title: t('userscripts.settings') || 'Settings',
									message: '',
									hideFooter: true,
									content: (
										<SettingsModal
											config={toolbarConfig || { order: ['add', 'export', 'import'], hideOnOverflow: false }}
											onSave={handleToolbarConfig}
											onClose={overlay.closeModal}
											t={t}
										/>
									)
								});
							}}
							title={t('userscripts.settings', { defaultValue: 'Settings' })}
						>
							⚙️
						</button>
					</div>

					{/* Toolbar */}
					<UserscriptsToolbar 
						config={toolbarConfig} 
						onAdd={() => { setEditingId(null); setShowEditor(true); }}
						onExport={() => handleExport(scripts)}
						onImport={() => setModalMode('import')}
					/>

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
					<UserscriptsTemplates onLoad={loadTemplate} />

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
				</div>
			</SlidePage>

			{/* Editor Page - slides in from right */}
			<SlidePage
				show={showEditor}
				direction="right"
				style={{
					display: 'flex',
					flexDirection: 'column',
					background: 'var(--halo-bg)',
					zIndex: 2,
				}}
			>
				<ScriptEditorPage
					form={editForm}
					onChange={setEditForm}
					onSave={handleSave}
					onCancel={handleCancel}
					isEdit={!!editingId}
					t={t}
				/>
			</SlidePage>
		</div>
	);
};
