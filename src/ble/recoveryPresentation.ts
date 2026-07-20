// recoveryPresentation.ts — decides how much of Home to take over when the
// phone key path is broken. Pure, so the policy is node-testable.
//
// THE DIVERGENCE FROM THE OFFICIAL APP (deliberate, and an improvement).
// Tesla's app HIDES every menu row when the phone key is unusable — Controls,
// Climate, Location, Summon, Charging all disappear behind a "Set Up Phone Key"
// card. That is correct FOR THEM: their only local path is BLE, so a bond wedge
// means literally nothing works and offering rows that all fail would be a lie.
//
// airgapp has a second, INDEPENDENT path: the Pi. With a Pi configured, a bond
// wedge costs us passive entry and direct-BLE commands — but every menu row
// still works over the Pi. Hiding them would be the lie in OUR case. So:
//
//   Pi configured    → 'banner'   — card ABOVE the menus, menus untouched.
//   BLE-only install → 'takeover' — hide the rows, mirroring the official app.
//
// GATED ON CONFIGURED, NOT ON CURRENTLY-REACHABLE. Tempting to require the Pi
// to be online right now, but Pi reachability flaps (sleep, Wi-Fi roam, the
// 5-min session outage we fixed). Flapping the entire menu in and out while the
// user stands at the car is far worse than briefly offering rows that will fail
// with the ordinary offline treatment the app already has. A configured Pi is a
// durable fact; its liveness is not.

import type { RecoveryRemedy } from './bondWedge';

export type RecoveryPresentation =
  | 'none' // nothing wrong — render Home normally
  | 'banner' // recovery card above an otherwise intact menu
  | 'takeover'; // recovery card INSTEAD of the menu (official-app behaviour)

export interface RecoveryView {
  presentation: RecoveryPresentation;
  remedy: RecoveryRemedy;
}

export function recoveryView(opts: {
  remedy: RecoveryRemedy;
  piConfigured: boolean;
}): RecoveryView {
  if (opts.remedy === 'none') return { presentation: 'none', remedy: 'none' };
  return {
    presentation: opts.piConfigured ? 'banner' : 'takeover',
    remedy: opts.remedy,
  };
}

// The card's call to action. Kept next to the presentation rule because the two
// are read together, and separate from bondWedge.ts's copy because a wiped key
// is NOT a bond problem and must never inherit the forget-device wording.
export function recoveryTitle(remedy: RecoveryRemedy): string {
  return remedy === 're-enroll-with-card' ? 'Set Up Phone Key' : 'Reconnect Bluetooth';
}

export function recoverySubtitle(remedy: RecoveryRemedy): string {
  return remedy === 're-enroll-with-card'
    ? 'Enable passive entry and remote controls'
    : 'Bluetooth needs to be re-paired';
}
