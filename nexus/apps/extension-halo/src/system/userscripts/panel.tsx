// goal: UserScripts panel - full Tampermonkey feature parity

import React from 'react';
import { useOverlay } from '../../components/ui/overlay';
import { useTranslation } from '../../i18n';
import { styles } from './styles';
import { ScriptItem } from './components/ScriptItem';
import { ScriptEditorPage } from './components/ScriptEditorPage';
import { EmptyState } from './components/EmptyState';
import { useUserScripts, useScriptEditor, useImportExport } from './hooks';
import { useUserscriptModals } from './hooks/use-userscript-modals';
import { UserscriptsToolbar } from './components/toolbar';
import { UserscriptsTemplates } from './components/templates';
import { MasterToggle, PermissionWarning } from './components/MainContents';
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
    const { openSettings } = useUserscriptModals(
        modalMode, setModalMode, exportData, handleImport, 
        handleToolbarConfig, toolbarConfig, overlay, t
    );

	React.useEffect(() => {
		const scriptId = sessionStorage.getItem('halo_edit_script');
		if (scriptId) {
			sessionStorage.removeItem('halo_edit_script');
			const script = scripts.find(s => s.id === scriptId || s.name === scriptId);
			if (script) handleEdit(script);
		}
	}, [scripts, handleEdit]);

	if (showEditor) return (
		<ScriptEditorPage form={editForm} onChange={setEditForm} onSave={handleSave} onCancel={handleCancel} isEdit={!!editingId} t={t} />
	);

	return (
		<div style={styles.wrapper}>
			<MasterToggle 
                enabled={globalEnabled} onToggle={handleGlobalToggle} onSettings={openSettings}
                title={t('userscripts.title', { defaultValue: 'User Scripts' })}
                subtitle={`${scripts.length} ${t('userscripts.scripts', { defaultValue: 'scripts' })} • ${scripts.filter(s => s.enabled).length} ${t('userscripts.active', { defaultValue: 'active' })}`}
                settingsTitle={t('userscripts.settings', { defaultValue: 'Settings' })}
            />
			<UserscriptsToolbar config={toolbarConfig} onAdd={() => { setEditingId(null); setShowEditor(true); }} onExport={() => handleExport(scripts)} onImport={() => setModalMode('import')} />

			{!hasPermission && (
				<PermissionWarning onEnable={handleRequestPermission} text={t('userscripts.permsMissing', { defaultValue: 'Permissions needed' })} btnText={t('userscripts.enableAuto', { defaultValue: 'Enable' })} />
			)}

			<UserscriptsTemplates onLoad={loadTemplate} />
			<div style={styles.sectionHeader}>
				<span style={styles.sectionTitle}>📜 {t('userscripts.myScripts', { defaultValue: 'My Scripts' })} ({scripts.length})</span>
			</div>

			{scripts.length === 0 ? <EmptyState t={t} /> : (
				<div style={styles.scriptList}>
					{scripts.map((script, i) => (
						<ScriptItem
							key={script.id} script={script} isFirst={i === 0} isLast={i === scripts.length - 1} t={t}
							onToggle={() => handleToggle(script.id)} onEdit={() => handleEdit(script)} onDelete={() => handleDelete(script.id)}
							onTest={() => handleTest(script)} onMove={(dir) => handleMove(script.id, dir)}
							isActive={hasPermission && currentUrl && globalEnabled ? (matchesUrl(script.matches, currentUrl) && (!script.excludeMatches || !matchesUrl(script.excludeMatches, currentUrl))) : false}
						/>
					))}
				</div>
			)}
		</div>
	);
};
