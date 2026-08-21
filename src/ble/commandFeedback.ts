// Per-command in-flight FEEDBACK class — how a control should look while its
// command is unresolved.
//
// Source: docs/superpowers/research/tesla-optimistic-buttons-FINDINGS.md (Round
// 13), a decompile of the official iOS app. Its headline: a button's in-flight
// look is the product of TWO independent facts —
//   (1) does the display fold the pending command onto polled state? → FLIP
//   (2) does the component wire status=BUSY? → SPINNER (icon replaced by BusyIcon)
// and Tesla picks ONE per control. Most flip; a few spin; momentary actions show
// nothing.
//
// ⚠️ We are currently BACKWARDS on the two that matter most. Our Home bar spins a
// control iff its CONTROL_AFFECTED_KEYS intersect `pending`: `lock` has ['locked']
// so it SPINS — but the report says lock FLIPS (no spinner). `frunk`/`trunk` have
// [] so they NEVER spin — but they are the ONE pair the report says SHOULD spin.
//
// This table is the report's §3 verdict as pure data, so the UI can drive the
// spinner off the command TYPE rather than off which state key happens to be
// pending. PURE (no RN) — same isolation rule as the rest of ble/*.

import type { CarCommand } from './commands';

export type FeedbackClass =
  // Flip the icon/label instantly, no spinner; revert on failure / 30s sweep.
  // The optimistic default — the poll reconciles it.
  | 'optimistic'
  // Replace the icon with a BusyIcon until the car acks; state does NOT flip.
  // Only frunk/trunk (+ a couple of car-server actions) in the official app.
  | 'spinner'
  // Momentary action with no state to reflect — no flip, no spinner, no pending.
  | 'fire-and-forget'
  // Local value during a drag/hold; the command fires once on release. The
  // control shows the local value, never a spinner.
  | 'release';

// Keyed by CarCommand['type']. Anything absent defaults to 'optimistic' (the
// report's common case), but every type is listed so the mapping is auditable.
const FEEDBACK: Record<CarCommand['type'], FeedbackClass> = {
  // ── Optimistic flip (selector folds the pending command; no spinner) ───────
  lock: 'optimistic',
  unlock: 'optimistic',
  sentry: 'optimistic',
  lowPowerMode: 'optimistic',
  keepAccessoryPower: 'optimistic',
  // Parental toggles flip a switch like the others; the two Clear-PIN actions have no state to
  // reflect (the row's subtitle just stops offering "Clear PIN" once the PIN is gone).
  parental: 'optimistic',
  valetClearPin: 'fire-and-forget',
  pinToDriveClearPin: 'fire-and-forget',
  openChargePort: 'optimistic',
  closeChargePort: 'optimistic',
  unlatchDriverDoor: 'optimistic', // optimistically pops the door open; car telemetry confirms/reverts
  ventWindows: 'optimistic',
  closeWindows: 'optimistic',
  chargeStart: 'optimistic',
  chargeStop: 'optimistic',
  climateOn: 'optimistic',
  climateOff: 'optimistic',
  seatHeater: 'optimistic', // report: status explicitly forced BUSY→NONE — never spins
  seatCooler: 'optimistic',
  steeringWheelHeat: 'optimistic',
  defrostOn: 'optimistic',
  defrostOff: 'optimistic',
  cabinOverheat: 'optimistic',
  setCopTemp: 'optimistic',
  bioweaponMode: 'optimistic', // report: REFLECT (poll-only) — treat as optimistic-flip for us
  valet: 'optimistic',
  pinToDrive: 'optimistic',
  speedLimit: 'optimistic',

  // ── Spinner (BusyIcon until ack; does NOT flip) ────────────────────────────
  openFrunk: 'spinner',
  openTrunk: 'spinner',
  closeTrunk: 'spinner',
  remoteStart: 'spinner', // brief spinner while dispatching, then active + countdown
  climateKeeper: 'spinner', // "the climate buttons that spin" — Keep/Dog/Camp

  // ── Fire-and-forget (momentary; no feedback) ───────────────────────────────
  honk: 'fire-and-forget',
  flashLights: 'fire-and-forget',
  homelink: 'fire-and-forget',
  boombox: 'fire-and-forget',
  wake: 'fire-and-forget',
  media: 'fire-and-forget',

  // ── Release (local during interaction, command on release; no spinner) ─────
  setChargeLimit: 'release',
  setChargingAmps: 'release',
  setClimateTemp: 'release',

  // ── Nav — no in-flight affordance on the button itself ─────────────────────
  navigateTo: 'optimistic',
  navigateWaypoints: 'optimistic',
  // Schedules: the LOCAL store is the optimistic surface and it commits
  // independently of the car. The car push is fire-and-forget — a car-side
  // failure must not roll back the saved schedule the user is looking at; the
  // next schedule readback reconciles truth.
  addChargeSchedule: 'fire-and-forget',
  removeChargeSchedule: 'fire-and-forget',
  addPreconditionSchedule: 'fire-and-forget',
  removePreconditionSchedule: 'fire-and-forget',
};

export function feedbackClass(type: CarCommand['type']): FeedbackClass {
  return FEEDBACK[type] ?? 'optimistic';
}

export const spins = (type: CarCommand['type']): boolean => feedbackClass(type) === 'spinner';
export const isFireAndForget = (type: CarCommand['type']): boolean =>
  feedbackClass(type) === 'fire-and-forget';
