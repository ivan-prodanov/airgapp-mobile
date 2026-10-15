// chargingAlerts — the car's own name for why charging stopped or slowed, with the
// words Tesla's app prints under it.
//
// Source: VehicleData.alert_state (GetVehicleData.getAlertState = 20 → VehicleData 25),
// `repeated ChargingAlert { alert_name: ChargingAlertName; alert_type: ChargingAlertType }`.
// The car serves it locally (QtCarServer alert_state handler); the official app has the
// UI (VehicleChargingAlertsRow) but never requests it over BLE. We do. Full recovery in
// docs/superpowers/research/tesla-charging-alerts-FINDINGS.md.
//
// PURE — no RN imports; the table is data (chargingAlertTable.ts, generated).

import type { ChargingAlertFamily, ChargingAlertInfo, ChargingAlertKind } from '../types/vehicleTypes';
import { CHARGING_ALERT_TABLE, type ChargingAlertRow } from './chargingAlertTable';

const BY_N = new Map<number, ChargingAlertRow>(CHARGING_ALERT_TABLE.map((r) => [r.n, r]));
const BY_NAME = new Map<string, ChargingAlertRow>(CHARGING_ALERT_TABLE.map((r) => [r.name, r]));

// alertFamily — which lever can clear it, keyed on Tesla's own remedy wording. FIRST
// matching rule wins, so the order is the policy:
//   info      a reduced-rate / heating notice: the car is still charging, nothing to restart
//   replug    Tesla says unplug / disconnect / reinsert / try again — the software re-plug
//   voltage-drop  "remove extension cords": V = I·R, so a lower current is the remedy
//   thermal   something is hot: dwell (cool down) then retry, lower current second time
//   power     the supply went away: retry, it may be back
//   dc        Supercharger / DC adapter / station faults: not a home-AC problem
//   equipment wiring / GFCI / service / configuration: the car cannot clear these
export function alertFamily(row: { title: string; subtitle: string }): ChargingAlertFamily {
  const text = `${row.title} ${row.subtitle}`.toLowerCase();
  if (/rate reduced|charging slowed|is heating|rate adjusted|rate will increase/.test(text)) return 'info';
  if (/unplug|disconnect|insert charge handle|plug adapter fully|try again/.test(text)) return 'replug';
  if (/voltage drop|extension cords|line impedance/.test(text)) return 'voltage-drop';
  if (/temperature|too hot|connection hot|cool/.test(text)) return 'thermal';
  if (/power lost|not providing power|not powered|grid|powerwall|ac power system/.test(text)) return 'power';
  // DC before equipment: "Supercharger stall out of SERVICE" is a station fault, not wiring.
  if (/supercharg|dc fast|stall|station|chademo|adapter|v2g|handle incompatible|arc flash/.test(text)) return 'dc';
  if (
    /service|inspect|wiring|grounding|gfci|primary|rotary|configuration|switch setting|current ratings|wall connector issue/.test(
      text,
    )
  ) {
    return 'equipment';
  }
  return 'other';
}

function kindOf(v: unknown): ChargingAlertKind {
  if (v === 1 || v === 'WARNING') return 'warning';
  if (v === 2 || v === 'NOTIFICATION') return 'notification';
  return 'unknown';
}

// chargingAlertInfo — look one alert up by wire number OR enum name. An unknown number
// is still returned (as ALERT_<n>) so a newer firmware's fault is shown rather than
// swallowed; INVALID_ALERT_NAME (0) and junk return null.
export function chargingAlertInfo(nameOrNumber: unknown, kind: ChargingAlertKind = 'unknown'): ChargingAlertInfo | null {
  let n: number | null = null;
  let row: ChargingAlertRow | undefined;
  if (typeof nameOrNumber === 'number' && Number.isFinite(nameOrNumber)) {
    n = nameOrNumber;
    row = BY_N.get(n);
  } else if (typeof nameOrNumber === 'string') {
    row = BY_NAME.get(nameOrNumber);
    if (row) n = row.n;
    else if (/^\d+$/.test(nameOrNumber)) {
      n = Number(nameOrNumber);
      row = BY_N.get(n);
    }
  }
  if (n === null || n === 0) return null;
  if (!row) {
    return {
      n,
      name: `ALERT_${n}`,
      title: `Charging alert ${n}`,
      subtitle: 'Unknown alert — check the car screen',
      family: 'other',
      kind,
    };
  }
  return { n: row.n, name: row.name, title: row.title, subtitle: row.subtitle, family: alertFamily(row), kind };
}

// parseChargingAlerts — a decoded CarServer.AlertState (or a toObject of one) → infos.
// Tolerant of both numeric and string enums, drops junk, collapses duplicates.
export function parseChargingAlerts(alertState: unknown): ChargingAlertInfo[] {
  if (!alertState || typeof alertState !== 'object') return [];
  const list = (alertState as { chargingAlerts?: unknown }).chargingAlerts;
  if (!Array.isArray(list)) return [];
  const out: ChargingAlertInfo[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const a = item as { alertName?: unknown; alertType?: unknown };
    const info = chargingAlertInfo(a.alertName, kindOf(a.alertType));
    if (!info || seen.has(info.name)) continue;
    seen.add(info.name);
    out.push(info);
  }
  return out;
}

// primaryChargingAlert — the one the card leads with and the restart plans around: the
// first actionable (non-info) alert, warnings before notifications. null = nothing to fix.
export function primaryChargingAlert(alerts: readonly ChargingAlertInfo[]): ChargingAlertInfo | null {
  const actionable = alerts.filter((a) => a.family !== 'info');
  return actionable.find((a) => a.kind === 'warning') ?? actionable[0] ?? null;
}
