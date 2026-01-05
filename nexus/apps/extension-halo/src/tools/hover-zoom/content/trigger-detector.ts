// goal: Detect valid triggers based on settings
// eff: Handles exemptions and event filtering

import type { HoverZoomSettings } from '../types';
import { resolveImageSource, ImageSource } from './image-resolver';

export class TriggerDetector {
	private settings: HoverZoomSettings;

	constructor(settings: HoverZoomSettings) {
		this.settings = settings;
	}

	updateSettings(settings: HoverZoomSettings) {
		this.settings = settings;
	}

	/**
	 * Check valid trigger
	 */
	detect(target: HTMLElement): ImageSource | null {
		// 1. Basic Element Check
		if (!target) return null;

		// 2. Exemption: Small interactive elements
		if (this.settings.exemptions.smallInteractive) {
			if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) ||
				target.getAttribute('role') === 'button' ||
				target.isContentEditable) {
				return null;
			}
		}

		// 3. Resolve Image
		const source = resolveImageSource(target);
		if (!source) return null;

		// 4. Exemption: Viewport coverage
		const rect = target.getBoundingClientRect();
		const viewportArea = window.innerWidth * window.innerHeight;
		const targetArea = rect.width * rect.height;

		if (targetArea / viewportArea > this.settings.exemptions.maxViewportCoverage) {
			return null;
		}

		if (rect.width / window.innerWidth > this.settings.exemptions.maxWidthCoverage) {
			return null;
		}

		return source;
	}

	/**
	 * Check key modifiers
	 */
	checkModifiers(e: MouseEvent): boolean {
		const { triggerKey } = this.settings;
		if (triggerKey === 'none') return true;
		if (triggerKey === 'shift') return e.shiftKey;
		if (triggerKey === 'ctrl') return e.ctrlKey;
		if (triggerKey === 'alt') return e.altKey;
		return true;
	}
}
