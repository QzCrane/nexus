// goal: EXIF Reader type definitions

export interface ExifData {
	make?: string;
	model?: string;
	exposureTime?: string;
	fNumber?: string;
	iso?: string;
	dateTime?: string;
	focalLength?: string;
	gps?: { lat: number; lng: number };
	width?: number;
	height?: number;
	software?: string;
}
