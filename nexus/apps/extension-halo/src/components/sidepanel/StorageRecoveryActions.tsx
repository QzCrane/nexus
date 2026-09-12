import type { ToolStateRecovery } from '../../kernel/core/storage-codec';

interface Props<T> {
	readonly recovery: ToolStateRecovery<T>;
	readonly emptyValue: T;
	readonly exportName: string;
}

export function StorageRecoveryActions<T>({ recovery, emptyValue, exportName }: Props<T>) {
	if (!recovery.invalid) return null;
	const exportRaw = () => {
		const blob = new Blob([JSON.stringify(recovery.invalid?.raw, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = exportName;
		anchor.click();
		URL.revokeObjectURL(url);
	};
	return <div role="alert" style={{ padding: 8, border: '1px solid var(--halo-border)', borderRadius: 6 }}>
		<p>Stored data is damaged or from an unsupported version. It was left unchanged.</p>
		<div style={{ display: 'flex', gap: 8 }}>
			<button type="button" onClick={exportRaw}>Export original data</button>
			<button type="button" onClick={() => recovery.replaceInvalid(emptyValue)}>Replace with empty data</button>
		</div>
	</div>;
}
