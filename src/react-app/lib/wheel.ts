/**
 * Mouse wheel or trackpad?
 *
 * Browsers report both as the same `wheel` event. On the canvas they should do
 * different things: a mouse wheel zooms, as it does in most canvas and map
 * apps, while two fingers on a trackpad pan, which is what a trackpad's scroll
 * gesture means everywhere else on a laptop. Pinching a trackpad arrives as a
 * wheel event with `ctrlKey` set and zooms either way.
 *
 * There is no flag for which device sent an event, so this reads the
 * fingerprints each one leaves. It only needs to be right about the first
 * event of a gesture: WallView keeps the answer until the scrolling stops,
 * so a fast trackpad flick doesn't turn into a zoom halfway through.
 */

export type WheelDevice = 'mouse' | 'trackpad';

/** The fields read here, so this can be tested without a real event. */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey?: boolean;
  /** Non-standard, but Chrome, Edge and Safari all send it. */
  wheelDeltaX?: number;
  wheelDeltaY?: number;
}

/**
 * One click of a mouse wheel on macOS, in Chrome and Safari: deltas there are
 * always a whole multiple of this. (Mapbox GL tells mice from trackpads the
 * same way.) It is 4 + 1/4096, exact in binary, so `%` against it is exact.
 */
export const MAC_WHEEL_STEP = 4.000244140625;

export function classifyWheel(e: WheelLike): WheelDevice {
  // Lines or pages, not pixels: a wheel. Firefox reports mice this way.
  if (e.deltaMode !== 0) return 'mouse';
  // Both axes at once, or sideways without Shift: a finger, not a wheel.
  if (e.deltaX !== 0 && (e.deltaY !== 0 || !e.shiftKey)) return 'trackpad';

  const value = e.deltaY || e.deltaX;
  if (value === 0) return 'trackpad';
  if (Math.abs(value) % MAC_WHEEL_STEP === 0) return 'mouse';

  const legacy = e.wheelDeltaY || e.wheelDeltaX || 0;
  // Chrome and Safari on a Mac trackpad report exactly -3 times the delta.
  if (legacy !== 0 && legacy === -3 * value) return 'trackpad';
  // On Windows a wheel click is 120 in the legacy units, however the delta is scaled.
  if (legacy !== 0 && legacy % 120 === 0) return 'mouse';
  // A click of a wheel moves a lot at once; a gesture starts with a small drift.
  return Math.abs(value) >= 40 ? 'mouse' : 'trackpad';
}

/**
 * How many wheel clicks one event stands for, so a click zooms the same amount
 * whether the browser counts it as 3 lines, 100 pixels, 53 pixels or 4.0002.
 * At least one, so a single click always does something, and at most four, so
 * an accelerated spin can't fling the zoom from one end to the other.
 */
export function wheelClicks(e: WheelLike): number {
  const value = Math.abs(e.deltaY || e.deltaX);
  const clicks =
    e.deltaMode === 1 ? value / 3
    : e.deltaMode === 2 ? value
    : value % MAC_WHEEL_STEP === 0 ? value / MAC_WHEEL_STEP
    : value / 100;
  return Math.min(4, Math.max(1, clicks));
}
