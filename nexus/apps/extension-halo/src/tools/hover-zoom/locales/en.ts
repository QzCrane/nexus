export const en = {
	// Registry i18n (required format)
	"tools.hover-zoom.name": "Hover Zoom",
	"tools.hover-zoom.desc": "View high-resolution images by hovering over thumbnails",

	// Panel i18n
	hoverZoom: {
		enable: "Enable Hover Zoom",
		enableDesc: "PhotoShow compatible, works on all websites",

		resourceKeys: {
			title: "Resource Keys",
			desc: "Configure hotkeys for image and video preview. More specific combos win.",
			image: "Image",
			video: "Video",
			tip: "Seamless switch: while viewing, press the other combo to switch between image/video without closing."
		},

		trigger: {
			title: "Trigger Settings",
			key: "Modifier Key",
			action: "Trigger Mode",
			hold: "Hold",
			toggle: "Toggle",
			delay: "Display Delay"
		},

		view: {
			title: "Appearance",
			highlight: "Trigger Highlight",
			viewMode: "Size Mode",
			borderRadius: "Border Style",
			loadingIndicator: "Loading Indicator",
			antiHotlink: "Anti-Hotlink (Privacy)",
			videoFallback: "Video → Image fallback"
		},

		viewMode: {
			original: "Original",
			fit: "Fit Screen"
		},

		highlight: {
			always: "Always",
			hotkey: "Hotkey",
			off: "Off"
		},

		altKeyMode: {
			label: "Alt key handling",
			compat: "Compatible",
			compatDesc: "Only block browser menu when viewer is visible",
			block: "Block Menu",
			blockDesc: "Always block browser menu when Alt is pressed"
		},

		exemptions: {
			title: "Trigger Exemptions",
			smallInteractive: "Ignore small interactive elements"
		},

		infoBar: {
			title: "Info Bar",
			typeIcon: "Type icon",
			dimensions: "Dimensions",
			ratio: "Ratio",
			scale: "Scale",
			format: "Format",
			size: "File size",
			caption: "Caption",
			source: "Rule source",
			hostname: "Image host"
		},

		hotkeys: {
			title: "Keyboard Shortcuts",
			download: "S - Save image",
			copy: "C - Copy URL",
			newtab: "T - Open in new tab",
			rotate: "R - Rotate 90°",
			close: "Esc - Close",
			pin: "Pin"
		},

		pinMode: {
			title: "Pin Mode",
			key: "Pin Key",
			keyDesc: "Press this key while viewing to pin the viewer (drag, resize). Empty = disabled.",
			space: "Space",
			none: "Disabled"
		}
	}
};
