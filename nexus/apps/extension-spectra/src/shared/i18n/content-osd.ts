// goal: resolve the tiny, current-locale OSD payload in the background context

export interface ContentOSDMessages {
	muted: string;
}

// The three route messages remain required on the v2 wire because an existing
// Content runtime can outlive a service-worker update and its frozen guard
// requires this complete shape. Current Content consumes only `muted`.
export interface ContentSettingsWireOSDMessages extends ContentOSDMessages {
	corsAutoAdded: string;
	corsAddedSafe: string;
	corsCorrectedSafe: string;
}

const ENGLISH_OSD_MESSAGES: Readonly<ContentSettingsWireOSDMessages> = {
	muted: 'MUTE',
	corsAutoAdded: 'Saved compatibility routing for {domain}',
	corsAddedSafe: 'Saved page-audio routing for {domain}',
	corsCorrectedSafe: 'Updated {domain} to page-audio routing',
};

const OSD_MESSAGES: Readonly<Record<string, Readonly<ContentSettingsWireOSDMessages>>> = {
	'en-US': ENGLISH_OSD_MESSAGES,
	'zh-CN': {
		muted: '静音',
		corsAutoAdded: '已保存 {domain} 的兼容路由',
		corsAddedSafe: '已保存 {domain} 的网页音频路由',
		corsCorrectedSafe: '已将 {domain} 更新为网页音频路由',
	},
	'zh-TW': {
		muted: '靜音',
		corsAutoAdded: '已儲存 {domain} 的相容路由',
		corsAddedSafe: '已儲存 {domain} 的網頁音訊路由',
		corsCorrectedSafe: '已將 {domain} 更新為網頁音訊路由',
	},
	'ja-JP': {
		muted: 'ミュート',
		corsAutoAdded: '{domain} の互換ルートを保存しました',
		corsAddedSafe: '{domain} のページ音声ルートを保存しました',
		corsCorrectedSafe: '{domain} をページ音声ルートに更新しました',
	},
	'ko-KR': {
		muted: '음소거',
		corsAutoAdded: '{domain}의 호환 라우팅을 저장했습니다',
		corsAddedSafe: '{domain}의 페이지 오디오 라우팅을 저장했습니다',
		corsCorrectedSafe: '{domain}을 페이지 오디오 라우팅으로 변경했습니다',
	},
	'es-ES': {
		muted: 'SILENCIO',
		corsAutoAdded: 'Se guardó el enrutamiento compatible para {domain}',
		corsAddedSafe: 'Se guardó el audio de página para {domain}',
		corsCorrectedSafe: 'Se actualizó {domain} al audio de página',
	},
	'ru-RU': {
		muted: 'БЕЗ ЗВУКА',
		corsAutoAdded: 'Для {domain} сохранён совместимый маршрут',
		corsAddedSafe: 'Для {domain} сохранён маршрут аудио страницы',
		corsCorrectedSafe: 'Для {domain} выбран маршрут аудио страницы',
	},
	'de-DE': {
		muted: 'STUMM',
		corsAutoAdded: 'Kompatibilitätsrouting für {domain} gespeichert',
		corsAddedSafe: 'Seitenaudio-Routing für {domain} gespeichert',
		corsCorrectedSafe: '{domain} auf Seitenaudio-Routing aktualisiert',
	},
	'fr-FR': {
		muted: 'MUET',
		corsAutoAdded: 'Routage compatible enregistré pour {domain}',
		corsAddedSafe: 'Routage audio de la page enregistré pour {domain}',
		corsCorrectedSafe: '{domain} utilise désormais l’audio de la page',
	},
};

export function getContentOSDMessages(language: string): ContentSettingsWireOSDMessages {
	return { ...(OSD_MESSAGES[language] ?? ENGLISH_OSD_MESSAGES) };
}

export function withContentOSDMessages<T extends { lang: string }>(
	settings: T,
): T & { osdMessages: ContentSettingsWireOSDMessages } {
	return {
		...settings,
		osdMessages: getContentOSDMessages(settings.lang),
	};
}
