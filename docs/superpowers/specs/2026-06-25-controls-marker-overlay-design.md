# Controls screen — marker overlay buttons + bottom-bar position

Date: 2026-06-25 · Branch: `phase4/engine-embed`

## Goal

Match the official Tesla "Controls" screen on two points:

1. **Bottom action bar** (Flash / Honk / Start / Vent) sits too high — drop it to the
   official position.
2. **Add the closure overlay buttons** over the top-down car: frunk **Open/Close**, trunk
   **Open/Close**, a center **lock/unlock** button, and a **charge-port** button — each at the
   location of its Godot marker.

No native or Godot changes → JS-only fast-deploy (`export:embed → hermesc → swap → resign →
install`), no full rebuild.

## What already exists (reuse, do not rebuild)

- `GodotRendererBridge`: `onMarkers()`, `requestMarkers()` (fired on boot/frame/camera-move),
  `onMarkerVisibility()` (false during camera animation, true once settled).
- Godot returns markers in **device pixels** (it scales the app frame by `pixel_ratio`,
  `camera.unproject_position(...)`, then `+= container.rect_position`). RN position =
  `markerPx / PixelRatio.get()`, in the same coordinate origin as the overlay layer.
- `actions.toggle('frunkOpen' | 'trunkOpen' | 'chargePortOpen' | 'locked')` — these feed the
  existing `UPDATE_PRODUCT` path (`ft` / `rt` / `charge_port_door_open`), so the 3D closures
  actually animate. `locked` is UI-only (no closure change), matching the official app.
- Overlay layer in `VehicleCanvas` (`<View styles.overlay box-none>{children}</View>`,
  `justifyContent: flex-end`); `ControlsScreen` renders as that child, inside the
  `BridgeContext.Provider`, so it can call `useGodotBridge()`.

## Part A — drop the bottom bar

`ControlsScreen.tsx`: add a single calibrated `BOTTOM_BAR_DROP` (layout points) applied as a
negative `marginBottom` on the bar, pulling it below the canvas's flex-end baseline to match the
official position. Calibrated on device. (Overlapping the temporary Home/Explore tab bar is
expected and fine.)

## Part B — marker overlay

New `src/godot/markerLayout.ts` (pure, unit-tested):

- `overlayAnchorsPx(markers)` → `{ frunk, trunk, lock, chargePort }` anchors in **device pixels**.
  - `lock` has no marker → **centroid of the 4 door markers** (true cabin center); fall back to
    the frunk↔trunk midpoint if a door is missing. Returns no entry for a button whose source
    markers are absent.
- `anchorToPoint(anchorPx, pixelRatio, { dx, dy })` → `{ left, top }` in layout points.
- `MARKER_CALIBRATION: Record<OverlayKey, { dx, dy }>` — per-button point offsets, applied after
  the pixel→point conversion. **This is the "margin" that nails each button to the exact official
  position.** Calibrated on device.

New `src/godot/MarkerOverlay.tsx` (or `src/components/`): `useGodotBridge()`, subscribes to
`onMarkers` + `onMarkerVisibility`, renders nothing until markers arrive and visibility is true
(no flicker during the camera move). Each button is a fixed-size box centered on its anchor
(`left = pointLeft − w/2`, `top = pointTop − h/2`):

| Button | Anchor | Visual | Action |
|---|---|---|---|
| Frunk | `frunk` | text **Open**/**Close** | `toggle('frunkOpen')` |
| Trunk | `trunk` | text **Open**/**Close** | `toggle('trunkOpen')` |
| Lock | doors centroid | `lock.fill` / `lock.open.fill` icon | `toggle('locked')` |
| Charge | `chargePort` | bolt icon | `toggle('chargePortOpen')` |

`ControlsScreen` renders `<MarkerOverlay>` (absolute, full-bleed, `box-none`) alongside the bar.

## Verification

`tsc` + `expo lint` + the markerLayout unit test, then **fast-deploy to the device and calibrate**
`MARKER_CALIBRATION` and `BOTTOM_BAR_DROP` against the official screenshots until each element
lands exactly.
