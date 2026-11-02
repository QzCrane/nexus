// goal: commit localized primary-card structure during parsing, before async state exists

import { I18N, getDict } from './popup/constants/i18n';
import { installPrepaintPopupCatalogs } from './shared/i18n/popup-catalog';
import { normalizeLanguage } from './shared/i18n/locale-sections';
import { readPopupAppearance } from './shared/popup-bootstrap';
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
if (template && stage && appearance?.hasMainCard === true) {
	applyDictionaryToRoot(template.content, dictionary);
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
		stage.append(fragment);
	}
}
