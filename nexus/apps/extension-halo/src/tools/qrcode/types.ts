// goal: QR Code tool type definitions with extended options

export interface QRCodeOptions {
	text: string;
	size: number;
	errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
	margin: number;
	darkColor: string;
	lightColor: string;
	logo?: string; // Data URL or URL
	logoSize?: number; // 0.1 to 0.3
}

export interface QRCodeState {
	text: string;
	generated: string | null; // data URL
	history: string[];
}

export interface ScanResult {
	data: string;
	location: {
		topLeft: { x: number; y: number };
		topRight: { x: number; y: number };
		bottomLeft: { x: number; y: number };
		bottomRight: { x: number; y: number };
	} | null;
}

export const DEFAULT_OPTIONS: Omit<QRCodeOptions, 'text'> = {
	size: 300,
	errorCorrectionLevel: 'H', // Use High for logo support
	margin: 2,
	darkColor: '#000000',
	lightColor: '#ffffff',
};

export const STORAGE_KEY = 'HALO_QRCODE_HISTORY';
export const MAX_HISTORY = 10;
