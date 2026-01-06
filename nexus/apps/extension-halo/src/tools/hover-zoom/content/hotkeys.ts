// goal: Comprehensive hotkey handler for Hover Zoom
// eff: S=Save, C=Copy, T=Tab, R=Rotate, Esc=Close, Arrow=Pan

import { HoverZoomSettings } from '../types';
import { HoverZoomViewer } from './viewer';

export class HotkeyManager {
	private settings: HoverZoomSettings;
	private viewer: HoverZoomViewer;
	private boundHandler: (e: KeyboardEvent) => void;
	private pauseKey = 'x'; // Hold to pause

	constructor(settings: HoverZoomSettings, viewer: HoverZoomViewer) {
		this.settings = settings;
		this.viewer = viewer;
		this.boundHandler = this.handleKey.bind(this);
		this.attach();
	}

	updateSettings(s: HoverZoomSettings) { this.settings = s; }
	attach() { window.addEventListener('keydown', this.boundHandler, true); }
	detach() { window.removeEventListener('keydown', this.boundHandler, true); }

	private handleKey(e: KeyboardEvent) {
		// Skip if typing in input
		const tag = (e.target as HTMLElement).tagName;
		if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
		if ((e.target as HTMLElement).isContentEditable) return;

		// Only act when viewer is visible (except pause key)
		if (!this.viewer.getIsVisible()) return;

		const key = e.key.toLowerCase();

		switch (key) {
			case 'escape':
				this.viewer.hide();
				e.preventDefault();
				break;

			case 's':
				this.viewer.downloadMedia();
				e.preventDefault();
				break;

			case 'c':
				this.viewer.copyUrl();
				e.preventDefault();
				break;

			case 't':
				this.viewer.openInNewTab();
				e.preventDefault();
				break;

			case 'r':
				this.viewer.rotate(90);
				e.preventDefault();
				break;

			case 'arrowleft':
				if (e.ctrlKey && e.shiftKey) {
					this.viewer.rotate(-90);
					e.preventDefault();
				}
				break;

			case 'arrowright':
				if (e.ctrlKey && e.shiftKey) {
					this.viewer.rotate(90);
					e.preventDefault();
				}
				break;
		}
	}
}
