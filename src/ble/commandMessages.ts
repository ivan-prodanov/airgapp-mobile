// commandMessages.ts — the error→message taxonomy for a FAILED command.
//
// PURE (types-only imports): given a human action label and a failed
// CommandOutcome, returns the short, friendly, action-prefixed line the toast
// host shows (mirrors the Tesla app's "failed operation" strings, but with a
// reason). Kept here — not in gateway.ts — so it stays node-testable and free
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

// commandFailureMessage renders the toast line for a failed command. actionLabel
// is a display verb like "Lock"; it is lowercased into the sentence.
export function commandFailureMessage(actionLabel: string, outcome: FailureOutcome): string {
  const action = actionLabel.toLowerCase();
  switch (outcome.kind) {
    case 'unreachable':
    case 'exhausted':
      return `Couldn't ${action} — car out of range or asleep`;
    case 'timeout':
      return `Couldn't ${action} — the car didn't respond`;
    case 'auth':
      return `Couldn't ${action} — this phone isn't paired. Re-enrol it.`;
    case 'fault':
      if (outcome.faultName === 'UNKNOWN_KEY_ID') {
        return `Couldn't ${action} — this phone isn't paired. Re-enrol it.`;
      }
      if (outcome.faultName === 'INSUFFICIENT_PRIVILEGES') {
        return `Couldn't ${action} — not allowed for this key`;
      }
      return `Couldn't ${action} — the car declined the request`;
  }
}
