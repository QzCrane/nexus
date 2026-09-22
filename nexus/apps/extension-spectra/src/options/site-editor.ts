// goal: handles the per-site hotkey configuration interface, allowing domain-specific overrides for global shortcuts

import type {
	HotkeyBinding,
	HotkeySettings,
	HotkeySiteMutation,
} from '@nexus/contracts';
import {
	DEFAULT_HOTKEY_SETTINGS,
	normalizeHostname,
	type SettingsUiSnapshot,
} from '@nexus/contracts/ui-settings-runtime';
import { openModal } from './modal';
import {
	getOptionsSettingsSnapshot,
	patchOptionsSettings,
} from '../shared/options-settings-client';
import { getActionName, getCurrentLang, onLangChange, t, tf } from './i18n';
import { clearOptionsError, showOptionsError } from './status';
import { formatKeyCombo } from './formatters';

let settings: HotkeySettings = { ...DEFAULT_HOTKEY_SETTINGS };
let selectedSite: string | null = null;
let siteInputErrorKey: 'invalid_domain' | 'site_exists' | null = null;
let pendingDeleteDomain: string | null = null;

// eff: initializes the site editor by loading saved configurations and populating the domain selector
export async function initSiteEditor(initialSnapshot?: SettingsUiSnapshot): Promise<void> {
	if (initialSnapshot) acceptSettingsSnapshot(initialSnapshot);
	else await loadSettings();
	renderLegacyWarning();
	renderSiteSelector();
	bindEvents();
	onLangChange(() => {
		renderLegacyWarning();
		renderBindings();
		renderSiteInputError();
		renderDeleteDialog();
	});
}

function renderLegacyWarning(): void {
	const warning = document.getElementById('legacy-hotkeys-warning');
	if (!warning) return;
	const count = settings.disabledLegacyBindings?.length ?? 0;
	warning.hidden = count === 0;
	warning.textContent = count === 0
		? ''
		: count === 1 ? t('legacy_disabled_one') : tf('legacy_disabled_many', { count });
}

async function loadSettings(forceRefresh = false): Promise<void> {
	acceptSettingsSnapshot(await getOptionsSettingsSnapshot(forceRefresh));
	clearOptionsError();
}

function acceptSettingsSnapshot(snapshot: SettingsUiSnapshot): void {
	settings = {
		...snapshot.hotkeySettings,
		slots: { ...snapshot.hotkeySettings.slots },
		sites: { ...snapshot.hotkeySettings.sites },
	};
}

export function projectSiteEditor(snapshot: SettingsUiSnapshot): void {
	acceptSettingsSnapshot(snapshot);
	renderLegacyWarning();
	renderSiteSelector();
	if (selectedSite && settings.sites[selectedSite]) selectSite(selectedSite);
	else hideSiteConfig();
}

async function mutateSite(domain: string, mutation: HotkeySiteMutation): Promise<void> {
	const snapshot = await patchOptionsSettings({
		scope: 'hotkey-site-mutation',
		domain,
		mutation,
	});
	settings = {
		...snapshot.hotkeySettings,
		slots: { ...snapshot.hotkeySettings.slots },
		sites: { ...snapshot.hotkeySettings.sites },
		disabledLegacyBindings: [...(snapshot.hotkeySettings.disabledLegacyBindings ?? [])],
	};
}

async function recoverEditorState(): Promise<void> {
	await loadSettings(true).catch(showOptionsError);
	renderLegacyWarning();
	renderSiteSelector();
	if (selectedSite && settings.sites[selectedSite]) selectSite(selectedSite);
	else hideSiteConfig();
}

async function applyBindingMutation(domain: string, mutation: HotkeySiteMutation): Promise<void> {
	try {
		await mutateSite(domain, mutation);
		if (selectedSite === domain) {
			selectSite(domain);
			renderLegacyWarning();
		}
	} catch (error) {
		showOptionsError(error);
		await recoverEditorState();
	}
}

// eff: updates the domain dropdown with all currently configured websites from the user's settings
function renderSiteSelector(): void {
	const select = document.getElementById('site-select') as HTMLSelectElement | null;
	if (!select) return;
	while (select.options.length > 1) select.remove(1);
	Object.keys(settings.sites).forEach(domain => {
		const opt = document.createElement('option');
		opt.value = domain;
		opt.textContent = domain;
		select.appendChild(opt);
	});
	if (selectedSite && settings.sites[selectedSite]) select.value = selectedSite;
}

function bindEvents(): void {
	const select = document.getElementById('site-select') as HTMLSelectElement | null;
	select?.addEventListener('change', () => select.value ? selectSite(select.value) : hideSiteConfig());

	// note: new manual domain input handler
	const siteInput = document.getElementById('site-input') as HTMLInputElement | null;
	const addBtn = document.getElementById('site-add-btn');

	addBtn?.addEventListener('click', () => addSiteFromInput(siteInput?.value));
	siteInput?.addEventListener('input', clearSiteInputError);
	siteInput?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			void addSiteFromInput(siteInput.value);
		}
	});

	const enabledCb = document.getElementById('site-enabled') as HTMLInputElement | null;
	enabledCb?.addEventListener('change', async () => {
		if (!selectedSite || !settings.sites[selectedSite]) return;
		const domain = selectedSite;
		try {
			await mutateSite(domain, { type: 'set-enabled', enabled: enabledCb.checked });
			if (selectedSite === domain) selectSite(domain);
		} catch (error) {
			showOptionsError(error);
			await recoverEditorState();
		}
	});

	document.getElementById('site-delete')?.addEventListener('click', requestSiteDeletion);
	document.getElementById('site-delete-confirm')?.addEventListener('click', (event) => {
		event.preventDefault();
		void confirmSiteDeletion();
	});
	document.getElementById('site-delete-dialog')?.addEventListener('close', () => {
		pendingDeleteDomain = null;
	});
	document.getElementById('site-add-binding')?.addEventListener('click', () => {
		if (!selectedSite) return;
		const domain = selectedSite;
		openModal(null, (binding) => {
			void applyBindingMutation(domain, { type: 'upsert-binding', binding });
		});
	});
}

// eff: validates and adds a new site from manual domain input
async function addSiteFromInput(rawDomain: string | undefined): Promise<void> {
	const domain = normalizeHostname(rawDomain ?? '');

	if (!domain) {
		setSiteInputError('invalid_domain');
		return;
	}

	try {
		await loadSettings(true);
		if (settings.sites[domain]) {
			setSiteInputError('site_exists');
			return;
		}
		await mutateSite(domain, { type: 'ensure-site', enabled: false });
	} catch (error) {
		showOptionsError(error);
		await recoverEditorState();
		return;
	}
	renderSiteSelector();

	// note: auto-select the newly added site
	const select = document.getElementById('site-select') as HTMLSelectElement | null;
	if (select) { select.value = domain; selectSite(domain); }

	// note: clear input field
	const input = document.getElementById('site-input') as HTMLInputElement | null;
	if (input) input.value = '';
	clearSiteInputError();
}

function setSiteInputError(key: 'invalid_domain' | 'site_exists'): void {
	siteInputErrorKey = key;
	renderSiteInputError();
	(document.getElementById('site-input') as HTMLInputElement | null)?.focus();
}

function clearSiteInputError(): void {
	siteInputErrorKey = null;
	renderSiteInputError();
}

function renderSiteInputError(): void {
	const input = document.getElementById('site-input') as HTMLInputElement | null;
	const message = document.getElementById('site-input-error');
	if (!input || !message) return;
	const invalid = siteInputErrorKey !== null;
	input.setAttribute('aria-invalid', String(invalid));
	message.hidden = !invalid;
	message.textContent = siteInputErrorKey ? t(siteInputErrorKey) : '';
}

// eff: displays the configuration sub-panel for the chosen domain and populates its current key bindings
function selectSite(domain: string): void {
	selectedSite = domain;
	const config = settings.sites[domain];
	if (!config) return;
	document.getElementById('site-config')?.classList.remove('hidden');
	document.getElementById('site-empty')?.classList.add('hidden');
	setSiteConfigVisibility(true);
	const domainEl = document.getElementById('site-domain');
	if (domainEl) domainEl.textContent = domain;
	const enabledCb = document.getElementById('site-enabled') as HTMLInputElement | null;
	if (enabledCb) enabledCb.checked = config.enabled;
	renderBindings();
}

function hideSiteConfig(): void {
	selectedSite = null;
	document.getElementById('site-config')?.classList.add('hidden');
	document.getElementById('site-empty')?.classList.remove('hidden');
	setSiteConfigVisibility(false);
}

function setSiteConfigVisibility(visible: boolean): void {
	const config = document.getElementById('site-config');
	if (!config) return;
	config.hidden = !visible;
	config.setAttribute('aria-hidden', String(!visible));
	config.toggleAttribute('inert', !visible);
}


function requestSiteDeletion(): void {
	if (!selectedSite) return;
	pendingDeleteDomain = selectedSite;
	renderDeleteDialog();
	const dialog = document.getElementById('site-delete-dialog') as HTMLDialogElement | null;
	dialog?.showModal();
}

function renderDeleteDialog(): void {
	const message = document.getElementById('site-delete-message');
	if (message && pendingDeleteDomain) {
		message.textContent = tf('delete_site_confirm', { domain: pendingDeleteDomain });
	}
}

async function confirmSiteDeletion(): Promise<void> {
	const deletedDomain = pendingDeleteDomain;
	if (!deletedDomain) return;
	const dialog = document.getElementById('site-delete-dialog') as HTMLDialogElement | null;
	const confirmButton = document.getElementById('site-delete-confirm') as HTMLButtonElement | null;
	const cancelButton = document.getElementById('site-delete-cancel') as HTMLButtonElement | null;
	if (confirmButton) confirmButton.disabled = true;
	if (cancelButton) cancelButton.disabled = true;
	try {
		await mutateSite(deletedDomain, { type: 'delete-site' });
	} catch (error) {
		showOptionsError(error);
		await recoverEditorState();
		dialog?.close();
		return;
	} finally {
		if (confirmButton) confirmButton.disabled = false;
		if (cancelButton) cancelButton.disabled = false;
	}
	renderSiteSelector();
	if (selectedSite === deletedDomain) hideSiteConfig();
	dialog?.close();
}

// Note: renderBindings and createBindingRow handle the visual representation of individual hotkey assignments
function renderBindings(): void {
	const container = document.getElementById('site-bindings-list');
	if (!container || !selectedSite) return;
	const config = settings.sites[selectedSite];
	if (!config) return;
	container.replaceChildren();
	const domain = selectedSite;
	config.bindings.forEach((binding) => {
		const row = createBindingRow(domain, binding);
		container.appendChild(row);
	});
}

function createBindingRow(domain: string, binding: HotkeyBinding): HTMLElement {
	const row = document.createElement('div');
	row.className = 'binding-row';

	const keyEl = document.createElement('span');
	keyEl.className = 'binding-key';
	keyEl.textContent = formatKeyCombo(binding.key);
	row.appendChild(keyEl);

	const actionEl = document.createElement('span');
	actionEl.className = 'binding-action';
	const actionName = getActionName(binding.action, getCurrentLang());
	actionEl.textContent = actionName;
	row.appendChild(actionEl);

	const editBtn = document.createElement('button');
	editBtn.className = 'btn btn-small';
	editBtn.textContent = '✏️';
	editBtn.type = 'button';
	editBtn.setAttribute('aria-label', tf('edit_hotkey_aria', { action: actionName }));
	editBtn.addEventListener('click', () => {
		openModal(binding, (updated) => {
			void applyBindingMutation(domain, { type: 'upsert-binding', binding: updated });
		});
	});
	row.appendChild(editBtn);

	const delBtn = document.createElement('button');
	delBtn.className = 'btn btn-small btn-danger';
	delBtn.textContent = '🗑️';
	delBtn.type = 'button';
	delBtn.setAttribute('aria-label', tf('delete_hotkey_aria', { action: actionName }));
	delBtn.addEventListener('click', async () => {
		await applyBindingMutation(domain, { type: 'remove-binding', bindingId: binding.id });
	});
	row.appendChild(delBtn);

	return row;
}
