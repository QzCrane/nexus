import { useSyncExternalStore } from 'react';
import { useTranslation } from '../../i18n';
import { subscribeStorageHealth, storageHealthRevision, storageProblemCount, retryStorageProblems } from '../../kernel/core/storage-health';

export function StorageHealthBanner() {
	useSyncExternalStore(subscribeStorageHealth, storageHealthRevision, storageHealthRevision);
	const { t } = useTranslation();
	if (!storageProblemCount()) return null;
	return <aside role="alert" style={{ padding: '8px', color: 'var(--halo-text)', background: 'var(--halo-bg-secondary)' }}>
		{t('storage.notConfirmed', { defaultValue: 'Saving or loading was not confirmed. Keep this panel open; your draft has not been discarded.' })}
		<button type="button" onClick={retryStorageProblems}>{t('common.retry', { defaultValue: 'Retry' })}</button>
	</aside>;
}
