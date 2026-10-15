import type { BaseModel } from '../state/carConfigurator';

// A real Tesla's appearance is not derivable — color, wheels, trim and seats are build options Tesla
// keeps server-side. The ONE thing the VIN gives us offline is the model line: position 4 (0-based
// index 3). Everything else the user picks (see the onboarding appearance step).
const LINE_BY_CHAR: Record<string, BaseModel> = { S: 'modelS', '3': 'model3', X: 'modelX', Y: 'modelY' };

export function vinToModelLine(vin: string): BaseModel | null {
  if (typeof vin !== 'string' || vin.length !== 17) return null;
  return LINE_BY_CHAR[vin[3].toUpperCase()] ?? null;
}
