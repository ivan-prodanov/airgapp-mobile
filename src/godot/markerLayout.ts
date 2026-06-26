import type { MarkerName, MarkerPoint, VehicleMarkers } from '../types/markerTypes';

// The four overlay buttons drawn over the top-down car. `lock` has no Godot marker — it is derived
// (see lockAnchorPx); the others map 1:1 to a marker of the same/related name.
export type OverlayKey = 'frunk' | 'trunk' | 'lock' | 'chargePort';

// Per-button fine-tuning in LAYOUT POINTS, applied AFTER the device-pixel → point conversion. Godot
// projects markers to roughly the right spot; these offsets nail each button to the exact position
// the official Tesla app uses. Calibrated on device against the reference screenshots.
export const MARKER_CALIBRATION: Record<OverlayKey, { dx: number; dy: number }> = {
  frunk: { dx: 0, dy: 0 },
  trunk: { dx: 0, dy: 0 },
  // Lock has no marker (doors centroid) — nudge it down onto the rear-seat area like the official app.
  lock: { dx: 0, dy: 38 },
  // Charge port marker sits on the car's rear-left corner; the official app draws it further out in
  // the left margin, so shift it left.
  chargePort: { dx: -40, dy: 0 },
};

const DOOR_MARKERS: MarkerName[] = ['doorFrontL', 'doorFrontR', 'doorRearL', 'doorRearR'];

// Markers arrive as [x, y] device-pixel pairs, but the dict also carries non-point entries
// (e.g. `frunk_color` HSV arrays), so validate shape before trusting a value.
function asPoint(value: unknown): MarkerPoint | null {
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    return [value[0], value[1]];
  }
  return null;
}

function centroid(points: MarkerPoint[]): MarkerPoint {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  return [sx / points.length, sy / points.length];
}

// The lock button sits dead-center on the cabin, but Godot has no center marker. Use the centroid of
// the four door markers (true cabin center, tracks the camera); fall back to the frunk↔trunk midpoint
// if any door is missing. All values are in DEVICE PIXELS (same space as the raw markers).
export function lockAnchorPx(markers: VehicleMarkers): MarkerPoint | null {
  const doors = DOOR_MARKERS.map((name) => asPoint(markers[name])).filter(
    (point): point is MarkerPoint => point !== null,
  );
  if (doors.length === DOOR_MARKERS.length) {
    return centroid(doors);
  }
  const frunk = asPoint(markers.frunk);
  const trunk = asPoint(markers.trunk);
  if (frunk && trunk) {
    return centroid([frunk, trunk]);
  }
  return null;
}

// Anchor (in DEVICE PIXELS) for each overlay button, omitting any whose source marker(s) are absent.
export function overlayAnchorsPx(markers: VehicleMarkers): Partial<Record<OverlayKey, MarkerPoint>> {
  const anchors: Partial<Record<OverlayKey, MarkerPoint>> = {};
  const frunk = asPoint(markers.frunk);
  const trunk = asPoint(markers.trunk);
  const chargePort = asPoint(markers.chargePort);
  const lock = lockAnchorPx(markers);
  if (frunk) {
    anchors.frunk = frunk;
  }
  if (trunk) {
    anchors.trunk = trunk;
  }
  if (chargePort) {
    anchors.chargePort = chargePort;
  }
  if (lock) {
    anchors.lock = lock;
  }
  return anchors;
}

// Convert a device-pixel anchor to an absolute {left, top} in layout points and apply the per-button
// calibration offset. A non-positive pixel ratio (shouldn't happen) is treated as 1 to avoid NaN.
export function anchorToPoint(
  anchorPx: MarkerPoint,
  pixelRatio: number,
  offset: { dx: number; dy: number },
): { left: number; top: number } {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  return {
    left: anchorPx[0] / ratio + offset.dx,
    top: anchorPx[1] / ratio + offset.dy,
  };
}
