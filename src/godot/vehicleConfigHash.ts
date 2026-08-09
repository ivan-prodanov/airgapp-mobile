import type { VehicleConfig } from '../types/vehicleTypes';

// A stable, opaque hash of the render-relevant config — the snapshot filename +
// cache key, mirroring how the official app keys per-config snapshots. Two cars
// with the same visible configuration share one snapshot (same hash → same PNG),
// so the fleet only ever renders each distinct look once.
//
// Pure + node-testable like the rest of src/godot's logic modules.

// Canonical serialization: sort object keys so field order can't change the hash.
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const obj = v as Record<string, unknown>;
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(obj[k]))
      .join(',') +
    '}'
  );
}

export function configHash(config: VehicleConfig): string {
  // The render is driven by the vehicle_config block (car_type / fascia / colors /
  // wheels / interior / seats / spoiler / calipers …). Hash its canonical form.
  const s = canonical(config.vehicle_config);
  // FNV-1a 32-bit → 8-char hex. Collision risk is negligible for a small fleet,
  // and a collision only means two cars share a (visually identical) thumbnail.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
