// goal: shared constants for the YouTube volume MAIN-world bridge and the
// ISOLATED-world reader that consumes its synced attribute.

// YouTube applies a non-linear volume curve to HTMLMediaElement.volume, so
// element.volume * 100 does not match the user-facing slider value. The
// MAIN-world bridge reads #movie_player.getVolume() (0–100, linear) and
// writes it to this attribute on <html>, which the ISOLATED-world
// native-media-executor reads back as the authoritative volumeBase.
export const SPECTRA_YOUTUBE_VOLUME_ATTRIBUTE = 'data-spectra-yt-volume';
