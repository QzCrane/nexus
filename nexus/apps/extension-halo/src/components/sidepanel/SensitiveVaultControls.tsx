import type { SensitiveVaultControls as Controls } from '../../kernel/hooks/use-sensitive-vault';

export function SensitiveVaultControls({ controls, exportName }: { readonly controls: Controls; readonly exportName: string }) {
	const exportLegacy = () => {
		if (!controls.legacyRaw) return;
		const url = URL.createObjectURL(new Blob([JSON.stringify(controls.legacyRaw, null, 2)], { type: 'application/json' }));
		const anchor = document.createElement('a'); anchor.href = url; anchor.download = exportName; anchor.click(); URL.revokeObjectURL(url);
	};
	const exportVault = () => {
		if (controls.vaultRaw === null) return;
		const url = URL.createObjectURL(new Blob([JSON.stringify(controls.vaultRaw, null, 2)], { type: 'application/json' }));
		const anchor = document.createElement('a'); anchor.href = url; anchor.download = `vault-${exportName}`; anchor.click(); URL.revokeObjectURL(url);
	};
	return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
		<span>{controls.status === 'legacy' ? 'Existing local data is loaded unchanged; new edits remain in memory.' : controls.status === 'vault' ? 'Saved in the private extension vault.' : 'New changes are kept in memory.'}</span>
		<button type="button" disabled={controls.status === 'loading' || controls.status === 'invalid'} onClick={() => void controls.saveToVault()}>Save to vault</button>
		{controls.legacyRaw && <button type="button" onClick={exportLegacy}>Export legacy data</button>}
		{controls.status === 'invalid' && controls.vaultRaw !== null && <button type="button" onClick={exportVault}>Export damaged vault data</button>}
		{controls.status === 'vault' && controls.legacyRaw && <button type="button" onClick={() => void controls.deleteLegacyAfterVault()}>Delete verified legacy copy</button>}
		{controls.error && <span role="alert">{controls.error}</span>}
	</div>;
}
