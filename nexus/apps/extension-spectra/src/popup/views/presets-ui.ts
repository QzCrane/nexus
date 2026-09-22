// goal: enhanced presets management with apply, search, global presets, default preset, and preview
// features: apply preset, global vs site-specific, search/filter, set as default, preview config

import type { AudioConfig } from '@nexus/kernel';
import { resolveAudioVolume } from '@nexus/contracts';
import type { I18NDict } from '../types';
import {
	getSettingsSnapshot,
	patchSettings,
	subscribeSettingsSnapshots,
} from '../../shared/settings-client';
import { handleDialogKeydown } from '../utils/dialog';
import { showPopupToast } from '../toast';
import {
	getPresetApplyTarget,
	subscribePresetTargetChanges,
	type PresetApplyTarget,
} from './preset-target';

// perf: preset types for global vs site-specific
export type PresetType = 'site' | 'global';

export interface PresetMeta {
	type: PresetType;
	name: string;
	createdAt: number;
	isDefault?: boolean;
}

export interface PresetEntry {
	config: Partial<AudioConfig>;
	meta: PresetMeta;
}

// perf: module-level state
let listEl: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let clearBtn: HTMLButtonElement | null = null;
let searchInput: HTMLInputElement | null = null;
let currentDict: I18NDict;
let currentDomain: string = '';
let closeActivePreview: ((restoreFocus?: boolean) => void) | null = null;
let closeActiveClearConfirmation: ((restoreFocus?: boolean) => void) | null = null;
let latestRefreshRevision = 0;
let unsubscribeSettings: (() => void) | null = null;

let unsubscribeTargetChanges: (() => void) | null = null;

function readPresetApplyTarget(): PresetApplyTarget | null {
	const target = getPresetApplyTarget();
	if (target) currentDomain = target.domain;
	return target;
}

function presentPresetFailure(error: unknown): void {
	showPopupToast(error instanceof Error ? error.message : String(error), 'error');
}

// eff: initializes the presets UI with search, filters, and action handlers.
// Preset application is intentionally target-driven: the active card registers
// the live tab identity and its acknowledged update/rollback pipeline after the
// Popup has initialized. There is no fallback callback that could apply a
// preset to an ambiguous or stale tab.
export function initPresetsUI(dict: I18NDict): void {
	disposePresetsUI();
	currentDict = dict;
	listEl = document.getElementById('presets-list');
	emptyEl = document.getElementById('presets-empty');
	clearBtn = document.getElementById('btn-clear-presets') as HTMLButtonElement | null;
	searchInput = document.getElementById('preset-search') as HTMLInputElement | null;

	currentDomain = '';

	if (clearBtn) clearBtn.onclick = showClearConfirmation;
	if (searchInput) {
		searchInput.oninput = () => { void refreshPresetsList().catch(presentPresetFailure); };
		searchInput.placeholder = currentDict.presetSearchPlaceholder;
	}
	unsubscribeTargetChanges = subscribePresetTargetChanges(() => {
		void refreshPresetsList().catch(presentPresetFailure);
	});


	// eff: refresh only from the background repository's validated snapshot event
	unsubscribeSettings = subscribeSettingsSnapshots(() => {
		void refreshPresetsList().catch(presentPresetFailure);
	});

	void refreshPresetsList().catch(presentPresetFailure);
}

// eff: refreshes the preset list with search filtering
export async function refreshPresetsList(): Promise<void> {
	if (!listEl || !emptyEl) return;
	const list = listEl;
	const empty = emptyEl;

	const refreshRevision = ++latestRefreshRevision;
	const { sitePresets, globalPresets, defaultId } = await loadAllPresets();
	if (refreshRevision !== latestRefreshRevision) return;
	const searchTerm = searchInput?.value.toLowerCase() || '';

	// perf: filter presets by search term
	const filteredSites = Object.entries(sitePresets).filter(([domain]) =>
		domain.toLowerCase().includes(searchTerm)
	);
	const filteredGlobals = Object.entries(globalPresets).filter(([name]) =>
		name.toLowerCase().includes(searchTerm)
	);

	const hasPresets = filteredSites.length > 0 || filteredGlobals.length > 0;

	list.replaceChildren();

	if (!hasPresets) {
		list.style.display = 'none';
		empty.style.display = 'block';
		if (clearBtn) clearBtn.style.display = 'none';
		return;
	}

	list.style.display = 'block';
	empty.style.display = 'none';
	if (clearBtn) clearBtn.style.display = 'inline-block';

	// eff: render global presets section
	if (filteredGlobals.length > 0) {
		const globalHeader = createSectionHeader(currentDict.presetGlobalSection);
		list.appendChild(globalHeader);

		filteredGlobals.forEach(([name, entry]) => {
			const item = createPresetItem(name, entry.config, 'global', entry.meta.isDefault === true || defaultId === name);
			list.appendChild(item);
		});
	}

	// eff: render site-specific presets section
	if (filteredSites.length > 0) {
		const siteHeader = createSectionHeader(currentDict.presetSiteSection);
		list.appendChild(siteHeader);

		filteredSites.forEach(([domain, config]) => {
			const isCurrentSite = domain === currentDomain;
			const item = createPresetItem(domain, config, 'site', false, isCurrentSite);
			list.appendChild(item);
		});
	}
}

// post: creates a section header element
function createSectionHeader(text: string): HTMLElement {
	const header = document.createElement('div');
	header.className = 'preset-section-header';
	header.textContent = text;
	return header;
}

// post: creates a preset item with actions (apply, preview, set default, delete)
function createPresetItem(
	id: string,
	config: Partial<AudioConfig>,
	type: PresetType,
	isDefault: boolean = false,
	isCurrentSite: boolean = false
): HTMLElement {
	const item = document.createElement('div');
	item.className = `preset-item ${type} ${isCurrentSite ? 'current' : ''}`;

	// info: left side - name, badges, summary
	const infoEl = document.createElement('div');
	infoEl.className = 'preset-info';

	const nameEl = document.createElement('div');
	nameEl.className = 'preset-name';

	const nameText = document.createElement('span');
	nameText.textContent = id;
	nameEl.appendChild(nameText);

	if (isDefault) {
		const defaultBadge = document.createElement('span');
		defaultBadge.className = 'preset-badge default';
		defaultBadge.textContent = currentDict.presetDefaultBadge;
		nameEl.appendChild(defaultBadge);
	}

	if (isCurrentSite) {
		const currentBadge = document.createElement('span');
		currentBadge.className = 'preset-badge current';
		currentBadge.textContent = currentDict.presetCurrentBadge;
		nameEl.appendChild(currentBadge);
	}

	const summaryEl = document.createElement('div');
	summaryEl.className = 'preset-summary';
	summaryEl.appendChild(createSummaryNodes(config));

	infoEl.appendChild(nameEl);
	infoEl.appendChild(summaryEl);

	// eff: right side - action buttons
	const actionsEl = document.createElement('div');
	actionsEl.className = 'preset-actions';

	// apply button
	const applyBtn = document.createElement('button');
	applyBtn.className = 'btn-preset-action apply';
	applyBtn.textContent = '✓';
	applyBtn.title = currentDict.presetApplyTooltip;
	applyBtn.setAttribute('aria-label', currentDict.presetApplyTooltip);
	const target = readPresetApplyTarget();
	const canApply = target !== null && (type === 'global' || target.domain === id);
	applyBtn.disabled = !canApply;
	applyBtn.setAttribute('aria-disabled', String(!canApply));
	applyBtn.onclick = (e) => {
		e.stopPropagation();
		void handleApplyPreset(id, type, config);
	};

	// preview button
	const previewBtn = document.createElement('button');
	previewBtn.className = 'btn-preset-action preview';
	previewBtn.textContent = '👁';
	previewBtn.title = currentDict.presetPreviewTooltip;
	previewBtn.setAttribute('aria-label', currentDict.presetPreviewTooltip);
	previewBtn.onclick = (e) => {
		e.stopPropagation();
		showPresetPreview(id, config);
	};

	// set default button (global presets only)
	const defaultBtn = document.createElement('button');
	defaultBtn.className = `btn-preset-action default ${isDefault ? 'active' : ''}`;
	defaultBtn.textContent = '★';
	defaultBtn.title = isDefault
		? currentDict.presetRemoveDefaultTooltip
		: currentDict.presetSetDefaultTooltip;
	defaultBtn.setAttribute('aria-label', defaultBtn.title);
	defaultBtn.onclick = (e) => {
		e.stopPropagation();
		handleSetDefaultPreset(id, type, !isDefault);
	};

	// delete button
	const deleteBtn = document.createElement('button');
	deleteBtn.className = 'btn-preset-action delete';
	deleteBtn.textContent = '✕';
	deleteBtn.title = currentDict.presetDeleteTooltip;
	deleteBtn.setAttribute('aria-label', currentDict.presetDeleteTooltip);
	deleteBtn.onclick = (e) => {
		e.stopPropagation();
		handleDeletePreset(id, type);
	};

	actionsEl.appendChild(applyBtn);
	actionsEl.appendChild(previewBtn);
	if (type === 'global') actionsEl.appendChild(defaultBtn);
	actionsEl.appendChild(deleteBtn);

	item.appendChild(infoEl);
	item.appendChild(actionsEl);

	return item;
}

// post: creates summary nodes with highlighted volume and speed
function createSummaryNodes(config: Partial<AudioConfig>): DocumentFragment {
	const fragment = document.createDocumentFragment();

	// eff: add volume with highlight — show the single effective volume the
	// user actually hears (volumeBase × boost) instead of splitting it into
	// a base/boost product. The product form leaked the hidden boost field
	// and read like a multiplier (e.g. "100% × 2.0") rather than the
	// one-control value the popup slider exposes (e.g. "200%").
	if (config.volume !== undefined) {
		const volSpan = document.createElement('span');
		volSpan.className = 'vol-highlight';
		const display = Number.isInteger(config.volume)
			? String(config.volume)
			: config.volume.toFixed(1).replace(/\.0$/u, '');
		volSpan.textContent = `${display}%`;
		fragment.appendChild(volSpan);
	}

	// eff: add speed with highlight
	if (config.speed !== undefined && config.speed !== 1.0) {
		if (fragment.childNodes.length > 0) {
			fragment.appendChild(document.createTextNode(' | '));
		}
		const spdSpan = document.createElement('span');
		spdSpan.className = 'spd-highlight';
		spdSpan.textContent = `${config.speed}x`;
		fragment.appendChild(spdSpan);
	}

	// eff: add other effects — labels come from the active i18n dictionary so
	// the summary respects the user's chosen language instead of leaking
	// English strings ("Comp", "Bass", "Pan:R", "Default", ...).
	const effects: string[] = [];
	if (config.compressor) effects.push(currentDict.presetEffectComp);
	if (config.bass) effects.push(currentDict.bass);
	if (config.mono) effects.push(currentDict.mono);
	if (config.pan !== undefined && config.pan !== 0) {
		const panLabel = currentDict.presetEffectPan;
		const panSide = config.pan > 0
			? currentDict.presetEffectPanRight
			: currentDict.presetEffectPanLeft;
		effects.push(`${panLabel}:${panSide}`);
	}

	if (effects.length > 0) {
		if (fragment.childNodes.length > 0) {
			fragment.appendChild(document.createTextNode(' | '));
		}
		fragment.appendChild(document.createTextNode(effects.join(' | ')));
	}

	if (fragment.childNodes.length === 0) {
		fragment.appendChild(document.createTextNode(currentDict.presetEffectDefault));
	}

	return fragment;
}

// eff: applies preset config to current site
async function handleApplyPreset(id: string, type: PresetType, config: Partial<AudioConfig>): Promise<void> {
	const target = readPresetApplyTarget();
	const domain = target?.domain || currentDomain;
	if (!target) {
		showPopupToast(currentDict.presetNoTarget, 'error');
		return;
	}
	if (type === 'site' && target && target.domain !== id) {
		showPopupToast(currentDict.presetNoTarget, 'error');
		return;
	}

	const previous = target?.readCurrent?.();
	try {
		await target.apply(config);

		// A global preset also becomes the selected site's persisted preset. If
		// persistence fails, restore the last acknowledged runtime config.
		if (type === 'global' && domain) {
			await patchSettings({ scope: 'audio-site', domain, value: config, mode: 'replace' });
		}
		showPopupToast(currentDict.presetAppliedToast(id));
	} catch (error: unknown) {
		if (target && previous) {
			try {
				await target.apply(previous);
			} catch (rollbackError: unknown) {
				presentPresetFailure(rollbackError);
			}
		}
		presentPresetFailure(error);
	}
}

// eff: shows preset details in a modal/preview panel
function showPresetPreview(id: string, config: Partial<AudioConfig>): void {
	closeActivePreview?.(false);
	const previouslyFocused = document.activeElement instanceof HTMLElement
		? document.activeElement
		: null;
	const modal = document.createElement('div');
	modal.className = 'preset-preview-modal';
	modal.id = 'preset-preview-modal';
	modal.setAttribute('role', 'dialog');
	modal.setAttribute('aria-modal', 'true');
	modal.setAttribute('aria-labelledby', 'preset-preview-title');
	modal.setAttribute('aria-describedby', 'preset-preview-details');
	modal.tabIndex = -1;

	const content = document.createElement('div');
	content.className = 'preset-preview-content';

	const header = document.createElement('h3');
	header.id = 'preset-preview-title';
	header.textContent = id;

	const details = document.createElement('dl');
	details.id = 'preset-preview-details';
	details.className = 'preset-preview-details';
	details.tabIndex = 0;
	for (const row of resolvePresetPreviewRows(config, currentDict)) {
		const term = document.createElement('dt');
		term.textContent = row.label;
		const value = document.createElement('dd');
		value.textContent = row.value;
		details.append(term, value);
	}

	const closeBtn = document.createElement('button');
	closeBtn.type = 'button';
	closeBtn.textContent = currentDict.btnClose;
	closeBtn.setAttribute('aria-label', currentDict.btnClose);
	const close = (restoreFocus = true) => {
		if (!modal.isConnected) return;
		modal.remove();
		if (closeActivePreview === close) closeActivePreview = null;
		if (restoreFocus) previouslyFocused?.focus();
	};
	closeActivePreview = close;
	closeBtn.onclick = () => close();

	content.appendChild(header);
	content.appendChild(details);
	content.appendChild(closeBtn);
	modal.appendChild(content);

	modal.onclick = (e) => {
		if (e.target === modal) close();
	};
	modal.addEventListener('keydown', (event) => handleDialogKeydown(event, modal, close));

	document.body.appendChild(modal);
	closeBtn.focus();
}

// eff: sets or removes a global preset as default
async function handleSetDefaultPreset(id: string, type: PresetType, setAsDefault: boolean): Promise<void> {
	if (type !== 'global') return;
	try {
		await patchSettings({ scope: 'default-preset', value: setAsDefault ? id : null });
		await refreshPresetsList();
	} catch (error: unknown) {
		presentPresetFailure(error);
	}
}

// eff: deletes a preset
async function handleDeletePreset(id: string, type: PresetType): Promise<void> {
	try {
		if (type === 'site') {
			await patchSettings({ scope: 'audio-site', domain: id, value: null });
		} else {
			await patchSettings({ scope: 'audio-preset', name: id, value: null });
		}
		await refreshPresetsList();
	} catch (error: unknown) {
		presentPresetFailure(error);
	}
}

function showClearConfirmation(): void {
	closeActiveClearConfirmation?.(false);
	const previouslyFocused = document.activeElement instanceof HTMLElement
		? document.activeElement
		: null;
	const modal = document.createElement('div');
	modal.className = 'preset-preview-modal';
	modal.setAttribute('role', 'dialog');
	modal.setAttribute('aria-modal', 'true');
	modal.setAttribute('aria-labelledby', 'preset-clear-title');
	modal.setAttribute('aria-describedby', 'preset-clear-description');
	modal.tabIndex = -1;

	const content = document.createElement('div');
	content.className = 'preset-preview-content';
	const title = document.createElement('h3');
	title.id = 'preset-clear-title';
	title.textContent = currentDict.presetClearTitle;
	const description = document.createElement('p');
	description.id = 'preset-clear-description';
	description.textContent = currentDict.presetClearBody;
	const actions = document.createElement('div');
	actions.className = 'presets-actions';
	const cancel = document.createElement('button');
	cancel.type = 'button';
	cancel.className = 'btn-small';
	cancel.textContent = currentDict.btnClose;
	const confirm = document.createElement('button');
	confirm.type = 'button';
	confirm.className = 'btn-small-danger';
	confirm.textContent = currentDict.presetClearConfirm;
	actions.append(cancel, confirm);
	content.append(title, description, actions);
	modal.append(content);
	document.body.append(modal);

	const close = (restoreFocus = true) => {
		if (!modal.isConnected) return;
		modal.remove();
		if (closeActiveClearConfirmation === close) closeActiveClearConfirmation = null;
		if (restoreFocus) previouslyFocused?.focus();
	};
	closeActiveClearConfirmation = close;
	cancel.onclick = () => close();
	confirm.onclick = () => {
		cancel.disabled = true;
		confirm.disabled = true;
		confirm.setAttribute('aria-busy', 'true');
		void patchSettings({ scope: 'audio-presets-clear' })
			.then(() => refreshPresetsList())
			.then(() => close())
			.catch((error: unknown) => {
				presentPresetFailure(error);
				cancel.disabled = false;
				confirm.disabled = false;
				confirm.removeAttribute('aria-busy');
			});
	};
	modal.onclick = (event) => {
		if (event.target === modal && !confirm.disabled) close();
	};
	modal.addEventListener('keydown', (event) => {
		handleDialogKeydown(event, modal, () => {
			if (!confirm.disabled) close();
		});
	});
	cancel.focus();
}

export interface PresetPreviewRow {
	label: string;
	value: string;
}

export function resolvePresetPreviewRows(
	config: Partial<AudioConfig>,
	dictionary: I18NDict,
): PresetPreviewRow[] {
	const rows: PresetPreviewRow[] = [];
	const state = (enabled: boolean) => enabled ? dictionary.presetStateOn : dictionary.presetStateOff;
	if (config.volume !== undefined || config.volumeBase !== undefined || config.boost !== undefined) {
		const hasCanonicalPair = config.volumeBase !== undefined || config.boost !== undefined;
		const effectiveVolume = hasCanonicalPair
			? resolveAudioVolume({
				volumeBase: config.volumeBase ?? 100,
				boost: config.boost ?? 1,
			}).effectiveVolume
			: config.volume ?? 100;
		rows.push({
			label: dictionary.presetPreviewVolume,
			value: `${effectiveVolume}%`,
		});
	}
	if (config.speed !== undefined) rows.push({ label: dictionary.spSpeed, value: `${config.speed}×` });
	if (config.enabled !== undefined) rows.push({ label: dictionary.presetPreviewEnabled, value: state(config.enabled) });
	if (config.muted !== undefined) rows.push({ label: dictionary.presetPreviewMuted, value: state(config.muted) });
	if (config.preservePitch !== undefined) {
		rows.push({ label: dictionary.presetPreviewPreservePitch, value: state(config.preservePitch) });
	}
	if (config.compressor !== undefined) rows.push({ label: dictionary.comp, value: state(config.compressor) });
	if (config.bass !== undefined) rows.push({ label: dictionary.bass, value: state(config.bass) });
	if (config.mono !== undefined) rows.push({ label: dictionary.mono, value: state(config.mono) });
	if (config.pan !== undefined) rows.push({ label: dictionary.spPan, value: String(config.pan) });
	if (config.delay !== undefined) rows.push({ label: dictionary.spDelay, value: `${config.delay} ms` });
	if (config.eqValues !== undefined) {
		rows.push({
			label: dictionary.eqTitle.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, ''),
			value: config.eqValues.map((value) => `${value > 0 ? '+' : ''}${value}`).join(' / '),
		});
	}
	if (rows.length === 0) rows.push({ label: dictionary.presetEffectDefault, value: dictionary.presetStateOn });
	return rows;
}

// eff: loads all presets from storage
async function loadAllPresets(): Promise<{
	sitePresets: Record<string, Partial<AudioConfig>>;
	globalPresets: Record<string, PresetEntry>;
	defaultId: string | null;
}> {
	const snapshot = await getSettingsSnapshot();

	return {
		sitePresets: snapshot.audioSites,
		globalPresets: snapshot.audioPresets,
		defaultId: snapshot.defaultPresetId,
	};
}

// eff: saves current config as a global preset
// Zero-interaction save: the preset name is auto-generated from the localized
// base label plus a compact timestamp, with a numeric suffix on collision so
// repeated saves within the same minute do not overwrite each other. The
// caller no longer prompts the user — the previous prompt pre-filled the
// current domain, which read as "name this after the domain" and was the
// root complaint behind the request that global presets stop being named
// after the domain.
export async function saveGlobalPreset(
	config: Partial<AudioConfig>,
	dict?: I18NDict,
): Promise<string> {
	const { globalPresets } = await loadAllPresets();
	// The card's save-as-global action can run before the settings drawer ever
	// mounted this view, so the module dictionary alone is not enough here.
	const active = dict
		?? currentDict
		?? (await import('./i18n-apply')).getCurrentDict();
	const baseName = active?.presetDefaultName ?? 'Preset';
	const stamp = formatPresetStamp(new Date());
	const name = resolveUniquePresetName(baseName, stamp, globalPresets);
	await patchSettings({
		scope: 'audio-preset',
		name,
		value: {
			config,
			meta: {
				type: 'global',
				name,
				createdAt: Date.now(),
			},
		},
	});
	return name;
}

function formatPresetStamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
		+ `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function resolveUniquePresetName(
	baseName: string,
	stamp: string,
	existing: Record<string, PresetEntry>,
): string {
	const candidate = `${baseName} ${stamp}`;
	if (!Object.hasOwn(existing, candidate)) return candidate;
	let seq = 2;
	while (Object.hasOwn(existing, `${candidate} (${seq})`)) seq += 1;
	return `${candidate} (${seq})`;
}

// goal: shows a transient toast notification
// goal: updates i18n dictionary
export function updatePresetsI18n(dict: I18NDict): void {
	currentDict = dict;
	if (searchInput) {
		searchInput.placeholder = dict.presetSearchPlaceholder;
	}
	void refreshPresetsList().catch(presentPresetFailure);
}

export function disposePresetsUI(): void {
	// Invalidate refreshes that are still awaiting the settings repository so a
	// disposed/reinitialized panel cannot repopulate a stale DOM list.
	latestRefreshRevision += 1;
	unsubscribeSettings?.();
	unsubscribeSettings = null;
	unsubscribeTargetChanges?.();
	unsubscribeTargetChanges = null;
	closeActivePreview?.(false);
	closeActivePreview = null;
	closeActiveClearConfirmation?.(false);
	closeActiveClearConfirmation = null;
	currentDomain = '';
}
