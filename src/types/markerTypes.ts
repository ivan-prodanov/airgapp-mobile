export type MarkerName =
  | 'frunk'
  | 'trunk'
  | 'chargePort'
  | 'doorFrontL'
  | 'doorFrontR'
  | 'doorRearL'
  | 'doorRearR'
  | 'wheel_1_1'
  | 'wheel_1_2'
  | 'wheel_2_1'
  | 'wheel_2_2'
  | 'dashboard'
  | 'steeringWheel'
  | 'seatRow1L'
  | 'seatRow1R'
  | 'seatRow2L'
  | 'seatRow2M'
  | 'seatRow2R'
  | 'seatRow3L'
  | 'seatRow3R';

export type MarkerPoint = [number, number];

export type VehicleMarkers = Partial<Record<MarkerName, MarkerPoint>> & Record<string, MarkerPoint | number[] | undefined>;

export interface MarkerOverlayAction {
  marker: MarkerName;
  label: string;
  active: boolean;
  onPress: () => void;
  tone?: 'text' | 'icon' | 'pill';
  icon?: 'lock' | 'unlock' | 'charge' | 'heat' | 'cool' | 'auto';
  positionMultiplier?: {
    x?: number;
    y?: number;
  };
}
