// goal: QR Code tool type definitions

export interface QRCodeOptions {
	text: string;
	size: number;
	errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
	margin: number;
}

export interface QRCodeState {
	text: string;
	generated: string | null; // data URL
	history: string[];
}

export const DEFAULT_OPTIONS: Omit<QRCodeOptions, 'text'> = {
	size: 200,
	errorCorrectionLevel: 'M',
	margin: 2,
};

export const STORAGE_KEY = 'HALO_QRCODE_HISTORY';
export const MAX_HISTORY = 10;
