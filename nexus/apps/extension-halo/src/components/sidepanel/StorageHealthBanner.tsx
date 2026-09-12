import { useSyncExternalStore } from 'react';
import { useTranslation } from '../../i18n';
import { subscribeStorageHealth, storageHealthRevision, storageProblemCount, storageProblemMessage, retryStorageProblems } from '../../kernel/core/storage-health';

export function StorageHealthBanner() {
	useSyncExternalStore(subscribeStorageHealth, storageHealthRevision, storageHealthRevision);
	const { t } = useTranslation();
	if (!storageProblemCount()) return null;
	return <aside role="alert" style={{ padding: '8px', color: 'var(--halo-text)', background: 'var(--halo-bg-secondary)' }}>
		{storageProblemMessage() ?? t('storage.notConfirmed', { defaultValue: 'Stored data needs attention, or saving/loading was not confirmed. Keep this panel open; existing data and your draft have not been discarded.' })}
		<button type="button" onClick={retryStorageProblems}>{t('common.retry', { defaultValue: 'Retry' })}</button>
	</aside>;
}
