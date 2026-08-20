// commandMessages.ts — the error→message taxonomy for a FAILED command.
//
// PURE (types-only imports): given a human action label and a failed
// CommandOutcome, returns the {title, body} the toast host renders as the
// app's two-line failure card ("Lock failed" / "Command timeout, please try
// again."). Kept here — not in gateway.ts — so it stays node-testable and free
// of any RN/Expo/network surface; useCarLink (RN-only) consumes it.
//
// Extensible: as the command sweep lands new controls, add a COMMAND_LABELS
// entry for a nicer verb; anything unmapped falls back to a title-cased type.

import type { CarCommand } from './commands';
import type { CommandOutcome } from './gateway';

// Every failure kind that is SHOWN to the user. `cancelled` (C3) is excluded on
// purpose: it means a newer command superseded this one, which the user caused
// and must never be told about. Excluding it here makes that a COMPILE error if
// anyone ever routes a cancelled outcome into the failure card, rather than a
// silent copy bug — and keeps the switch below exhaustive.
type FailureOutcome = Exclude<Extract<CommandOutcome, { ok: false }>, { kind: 'cancelled' }>;

// cmd.type → the verb shown in the sentence (Title case; lowercased inside the
// message). Extend as the sweep wires more live commands. Anything absent falls
// back to titleCase(type).
const COMMAND_LABELS: Partial<Record<CarCommand['type'], string>> = {
  lock: 'Lock',
  unlock: 'Unlock',
  wake: 'Wake',
  openFrunk: 'Open frunk',
  openTrunk: 'Open trunk',
  closeTrunk: 'Close trunk',
  openChargePort: 'Open charge port',
  closeChargePort: 'Close charge port',
  unlatchDriverDoor: 'Unlatch door',
  chargeStart: 'Start charging',
  chargeStop: 'Stop charging',
  climateOn: 'Turn on climate',
  climateOff: 'Turn off climate',
  ventWindows: 'Vent windows',
  closeWindows: 'Close windows',
  flashLights: 'Flash lights',
  honk: 'Honk',
  // Matches the button the user pressed ("Send to Car"), not the wire verb —
  // titleCase would otherwise render "Navigate to failed".
  navigateTo: 'Send to car',
};

// titleCase turns a camelCase command type into a spaced, capitalized phrase
// ("openFrunk" → "Open frunk") so an unmapped command still reads naturally.
function titleCase(type: string): string {
  const spaced = type.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function commandActionLabel(type: CarCommand['type']): string {
  return COMMAND_LABELS[type] ?? titleCase(type);
}

// CommandFailureText is the two-line toast card the official app shows on a
// failed command: a BOLD title naming what failed, and a muted body giving the
// reason. The bodies are Tesla's VERBATIM English, recovered from the app's
// inline i18n catalog (findings §3.2) — do not "normalize" their casing or
// punctuation: the inconsistency is real (findings §3.5 — full sentences end
// with a period, short labels like "Session Expired" are Title Case with none).
export interface CommandFailureText {
  title: string;
  body: string;
}

// commandFailureText renders the two-line failure card for a failed command.
// actionLabel is a display verb like "Lock" and is used VERBATIM in the title
// ("Lock failed"), matching the app's capitalization.
export function commandFailureText(
  actionLabel: string,
  outcome: FailureOutcome,
  type?: CarCommand['type'],
): CommandFailureText {
  return { title: `${actionLabel} failed`, body: failureBody(outcome, type) };
}

// failureBody is the reason line — the only part that varies by failure kind.
// Every string below is Tesla's exact English for the key named in the comment
// (findings §3.2). Note there is deliberately NO "vehicle asleep"/"offline"
// body: the official app's command-failure path has no such key — sleep is
// handled upstream by an auto-wake step (findings §3.2/§5.2), so inventing copy
// for it here would be a parity regression.
// The car's VCSEC rejection reasons (FromVCSECMessage.nominalError.genericError,
// surfaced by parseVcsecNominalError) rendered as readable copy, so ANY VCSEC
// command (lock/unlock/frunk/trunk/chargePort/…) shows a proper line instead of
// the raw enum name. lock + CLOSURES_OPEN keeps its exact Tesla copy below; this
// covers every other command/reason. GENERICERROR_ALREADY_ON never reaches here —
// the gateway treats it as a success.
const VCSEC_ERROR_BODY: Partial<Record<string, string>> = {
  GENERICERROR_CLOSURES_OPEN: 'One or more doors are open.',
  GENERICERROR_VEHICLE_NOT_IN_PARK: 'Vehicle is not in Park.',
  GENERICERROR_UNAUTHORIZED: 'Not authorized.',
  GENERICERROR_DISABLED_FOR_USER_COMMAND: 'This action is disabled.',
  GENERICERROR_NOT_ALLOWED_OVER_TRANSPORT: 'Not available over this connection.',
  GENERICERROR_UNKNOWN: 'Command failed',
};

function failureBody(outcome: FailureOutcome, type?: CarCommand['type']): string {
  // The car refuses to lock with a door open (nominalError GENERICERROR_CLOSURES_OPEN)
  // — Tesla's ONLY lock-rejection copy (command_error_LOCK_doors_open), verbatim.
  if (
    type === 'lock' &&
    outcome.kind === 'fault' &&
    outcome.faultName === 'carRejected' &&
    outcome.reason === 'GENERICERROR_CLOSURES_OPEN'
  ) {
    return 'Failed to lock vehicle. One or more doors are open.';
  }
  switch (outcome.kind) {
    case 'timeout':
      return 'Command timeout, please try again.'; // command_error_timeout
    case 'unreachable':
    case 'exhausted':
      return 'Vehicle Connection Error'; // vehicle_error_connection_error
    case 'auth':
      return 'Session Expired'; // vehicle_error_unauthorized
    case 'fault':
      if (outcome.faultName === 'UNKNOWN_KEY_ID') {
        // The phone key isn't enrolled on the car → vehicle_error_not_in_whitelist
        return 'Set up Phone Key and try again.';
      }
      if (outcome.faultName === 'INSUFFICIENT_PRIVILEGES') {
        return 'Unpair your phone key and pair it again to retry.'; // vehicle_error_insufficient_privileges
      }
      // The car answered with its OWN reason. A VCSEC nominalError maps to readable
      // copy (VCSEC_ERROR_BODY); anything else — e.g. a CarServer
      // Response.actionStatus result_reason.plain_text like "No PII request" on a
      // navigation send — is shown verbatim (it is the only text that says WHY).
      // `outcome.message` is deliberately NOT used — it carries a dev "[label]" prefix.
      if (outcome.reason) return VCSEC_ERROR_BODY[outcome.reason] ?? outcome.reason;
      return 'Command failed'; // command_error_GENERIC_
  }
}
