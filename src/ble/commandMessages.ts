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

type FailureOutcome = Extract<CommandOutcome, { ok: false }>;

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
  chargeStart: 'Start charging',
  chargeStop: 'Stop charging',
  climateOn: 'Turn on climate',
  climateOff: 'Turn off climate',
  ventWindows: 'Vent windows',
  closeWindows: 'Close windows',
  flashLights: 'Flash lights',
  honk: 'Honk',
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
// reason. Mirrors Tesla's copy — short, sentence-case, ends with a period.
export interface CommandFailureText {
  title: string;
  body: string;
}

// commandFailureText renders the two-line failure card for a failed command.
// actionLabel is a display verb like "Lock" and is used VERBATIM in the title
// ("Lock failed"), matching the app's capitalization.
export function commandFailureText(actionLabel: string, outcome: FailureOutcome): CommandFailureText {
  return { title: `${actionLabel} failed`, body: failureBody(outcome) };
}

// failureBody is the reason line — the only part that varies by failure kind.
function failureBody(outcome: FailureOutcome): string {
  switch (outcome.kind) {
    case 'timeout':
      return 'Command timeout, please try again.';
    case 'unreachable':
    case 'exhausted':
      return 'Car out of range or asleep, please try again.';
    case 'auth':
      return "This phone isn't paired with the car. Re-enrol it.";
    case 'fault':
      if (outcome.faultName === 'UNKNOWN_KEY_ID') {
        return "This phone isn't paired with the car. Re-enrol it.";
      }
      if (outcome.faultName === 'INSUFFICIENT_PRIVILEGES') {
        return "This key isn't allowed to do that.";
      }
      return 'The car declined the request.';
  }
}
