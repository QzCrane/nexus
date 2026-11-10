// goal: content-local broadcast for a palette fact that settles after the frame
// that predicted it
// inv: the owner of the fact and the surface that paints it never import each
// other; both agree on this one event name instead.

/**
 * The audio policy finished applying one route decision.
 *
 * A shortcut step must paint its colour in the input task, which means the pill
 * predicts the route the document is about to be on. The processor that route
 * hands the document to becomes real a moment later - and that moment is not an
 * acknowledgement of the gesture, so no ACK can correct the prediction. This
 * event is that correction: whoever owns a palette surface repaints from the now
 * settled state.
 */
export const SPECTRA_AUDIO_ROUTE_SETTLED_EVENT = 'spectra:audio-route-settled';
