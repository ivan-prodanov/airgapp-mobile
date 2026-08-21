// SF Symbol → Tesla glyph mapping, used to migrate the last `SymbolView` call sites
// off `expo-symbols` (iOS-only — it renders NOTHING on Android, silently, which is how
// every stack-header back chevron went missing on the first Android boot).
//
// Rotation convention, read off the path data rather than assumed:
//   chevron-0 / arrow-0    apex at the TOP     → points UP
//   chevron-90 / arrow-90  apex at the RIGHT   → points RIGHT
//   chevron-180            apex at the BOTTOM  → points DOWN
//   chevron-270            apex at the LEFT    → points LEFT
// i.e. degrees clockwise from up.
//
// This table exists for the migration and for the test below, which proves every target
// is a real glyph. Call sites use the Tesla name directly — they do not call sfToTesla at
// runtime — so once the migration is done this file's only job is guarding the invariant
// in sfFallback.test.ts that no SF names come back.

import type { TeslaIconName } from './TeslaIcon';

/**
 * Every SF Symbol name that appeared in a SymbolView call site before the migration,
 * derived by grepping `name=` props across src (32 distinct, 93 call sites, 25 files).
 */
export const SF_NAMES_IN_USE = [
  'chevron.left',
  'chevron.right',
  'chevron.up',
  'chevron.down',
  'bolt.fill',
  'xmark.circle.fill',
  'xmark',
  'plus',
  'arrow.turn.up.right',
  'wifi',
  'square.and.arrow.up',
  'speaker.wave.2.fill',
  'music.note',
  'mappin.circle.fill',
  'mappin',
  'magnifyingglass',
  'line.3.horizontal',
  'iphone',
  'ellipsis.message',
  'ellipsis',
  'delete.left',
  'checkmark',
  'location.north.fill',
  'arrow.clockwise',
  'largecircle.fill.circle',
  'circle',
  'trash',
  'microbe',
  'tent.fill',
  'pawprint.fill',
  'fanblades.fill',
  'arrow.up.right.square',
  'arrow.up.right',
  'backward.end.fill',
  'car.side.front.open.fill',
  'car.side.rear.open.fill',
  'car.top.door.front.left.open.fill',
  'car.top.door.front.right.open.fill',
  'car.top.door.rear.left.open.fill',
  'car.top.door.rear.right.open.fill',
  'car.window.left',
  'car.window.right',
  'ev.charger.fill',
  'forward.end.fill',
  'globe.americas.fill',
  'headlight.low.beam.fill',
  'light.beacon.max.fill',
  'location.fill',
  'lock.fill',
  'lock.open.fill',
  'mappin.and.ellipse',
  'moon.zzz.fill',
  'pause.fill',
  'phone.fill',
  'play.fill',
  'powerplug.fill',
  'safari',
  'steeringwheel',
  'sun.max.fill',
  'windshield.front.and.heat.waves',
  'windshield.rear.and.heat.waves',
] as const;

// Targets chosen by semantics at the call site, not by name similarity:
//   arrow.turn.up.right   Navigate button + SendToCarButton  → directions
//   location.north.fill   the map heading/recenter arrow      → navigate-filled
//   ellipsis.message      HomeScreen messages affordance      → message
//   square.and.arrow.up   SendToCarButton "send"              → share
//   largecircle/circle    selected/unselected radio rows      → radio-filled / radio
//   delete.left           PIN keypad backspace                → backspace (extraGlyphs.json;
//                         the extracted Tesla set has no backspace glyph)
const MAP: Record<(typeof SF_NAMES_IN_USE)[number], TeslaIconName> = {
  'chevron.left': 'chevron-270',
  'chevron.right': 'chevron-90',
  'chevron.up': 'chevron-0',
  'chevron.down': 'chevron-180',
  'bolt.fill': 'bolt-filled',
  'xmark.circle.fill': 'x-circle-filled',
  xmark: 'close',
  plus: 'plus',
  'arrow.turn.up.right': 'directions',
  wifi: 'wifi',
  'square.and.arrow.up': 'share',
  'speaker.wave.2.fill': 'speaker-filled-high',
  'music.note': 'music',
  'mappin.circle.fill': 'pin-filled',
  mappin: 'pin',
  magnifyingglass: 'search',
  'line.3.horizontal': 'menu',
  iphone: 'smartphone',
  'ellipsis.message': 'message',
  ellipsis: 'ellipsis',
  'delete.left': 'backspace',
  checkmark: 'check',
  'location.north.fill': 'navigate-filled',
  'arrow.clockwise': 'reload',
  'largecircle.fill.circle': 'radio-filled',
  circle: 'radio',
  trash: 'trash',
  microbe: 'biohazard',
  'tent.fill': 'camp',
  'pawprint.fill': 'dog',
  'fanblades.fill': 'fan-filled',
  'arrow.up.right.square': 'external',
  'arrow.up.right': 'external',
  'backward.end.fill': 'previous-filled',
  // The extracted Tesla set has ONE door glyph, not four per-door ones. explore.tsx is
  // the dev state-simulator, so all four door rows share `doors-open-filled`; the label
  // beside each row already says which door it is.
  'car.side.front.open.fill': 'frunk-filled',
  'car.side.rear.open.fill': 'trunk-filled',
  'car.top.door.front.left.open.fill': 'doors-open-filled',
  'car.top.door.front.right.open.fill': 'doors-open-filled',
  'car.top.door.rear.left.open.fill': 'doors-open-filled',
  'car.top.door.rear.right.open.fill': 'doors-open-filled',
  'car.window.left': 'vent-windows-filled',
  'car.window.right': 'vent-windows-filled',
  'ev.charger.fill': 'charge-filled',
  'forward.end.fill': 'next-filled',
  'globe.americas.fill': 'globe-filled',
  'headlight.low.beam.fill': 'lights-filled',
  'light.beacon.max.fill': 'warning-filled',
  'location.fill': 'crosshair-filled',
  'lock.fill': 'lock-filled',
  'lock.open.fill': 'unlock-filled',
  'mappin.and.ellipse': 'pin-filled',
  'moon.zzz.fill': 'moon-filled',
  'pause.fill': 'pause-filled',
  'phone.fill': 'phone-filled',
  'play.fill': 'play-filled',
  'powerplug.fill': 'power-filled',
  safari: 'globe',
  steeringwheel: 'steering-wheel',
  'sun.max.fill': 'sun-filled',
  'windshield.front.and.heat.waves': 'defrost-front-filled',
  'windshield.rear.and.heat.waves': 'defrost-rear-filled',
};

export function sfToTesla(sf: string): TeslaIconName | null {
  return (MAP as Record<string, TeslaIconName>)[sf] ?? null;
}
