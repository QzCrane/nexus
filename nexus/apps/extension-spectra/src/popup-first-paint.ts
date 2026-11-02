// goal: commit every announced card structure before async state exists

import { I18N, getDict } from './popup/constants/i18n';
import { installPrepaintPopupCatalogs } from './shared/i18n/popup-catalog';
import { normalizeLanguage } from './shared/i18n/locale-sections';
import { readAnnouncedBackgroundCount, readPopupAppearance } from './shared/popup-bootstrap';
import { readSettingsForecast } from './popup/settings-forecast';
import { applyDictionaryToRoot } from './popup/views/i18n-apply';

const appearance = readPopupAppearance(location.search);
const forecast = readSettingsForecast();
const language = normalizeLanguage(appearance?.language ?? forecast?.lang ?? 'en-US');
const dictionary = getDict(language);
installPrepaintPopupCatalogs(I18N);
document.documentElement.lang = language;
applyDictionaryToRoot(document, dictionary);
const template = document.querySelector<HTMLTemplateElement>('#tmpl-card');
const stage = document.querySelector<HTMLElement>('#main-stage');
const background = document.querySelector<HTMLElement>('#bg-stack');
if (template) applyDictionaryToRoot(template.content, dictionary);
function appendSlot(container: HTMLElement): void {
	if (!template) return;
	const fragment = template.content.cloneNode(true) as DocumentFragment;
	const card = fragment.querySelector<HTMLElement>('.glass-card');
	if (card) {
		card.dataset.spectraPrepaint = 'unbound';
		card.setAttribute('inert', '');
		card.setAttribute('aria-busy', 'true');
		card.querySelector('.sleep-mask')?.classList.add('hidden');
		const value = card.querySelector<HTMLElement>('.vol-number');
		if (value) value.textContent = '—';
		const speed = card.querySelector<HTMLInputElement>('.speed-input');
		if (speed) speed.value = '';
		const playback = card.querySelector<HTMLElement>('.btn-pause');
		if (playback) {
			playback.textContent = '…';
			playback.setAttribute('aria-pressed', 'mixed');
			playback.setAttribute('aria-busy', 'true');
		}
		if (!(appearance?.visualizerEnabled ?? forecast?.visualizerEnabled ?? true)) card.querySelector('.viz-island')?.classList.add('hidden');
		container.append(fragment);
	}
}
if (stage && appearance?.hasMainCard) appendSlot(stage);
const backgroundCount = readAnnouncedBackgroundCount(location.search);
if (background && appearance && backgroundCount !== null) {
	for (let index = 0; index < backgroundCount; index += 1) appendSlot(background);
	document.querySelector('#bg-header')?.classList.toggle('hidden', backgroundCount === 0);
	const badge = document.querySelector('#bg-badge');
	if (badge) badge.textContent = String(backgroundCount);
	document.documentElement.dataset.spectraStructureReady = 'true';
}
