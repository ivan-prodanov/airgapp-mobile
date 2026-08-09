import type { VehicleMarkers } from './markerTypes';

export type ReactToGodotType =
  | 'APP_CONFIG'
  | 'GODOT_CONFIG'
  | 'SET_APP_THEME'
  | 'SHOW_PRODUCT'
  | 'UPDATE_PRODUCT'
  | 'UPDATE_MAIN_VIEW_FRAME'
  | 'SET_ENV_PARAMS'
  | 'MOVE_CAMERA'
  | 'FADE_ROOF'
  | 'SHOW_FX_ABOVE'
  | 'SET_VEHICLE_LIGHTS'
  | 'GET_VEHICLE_MARKERS'
  // Off-screen snapshot request: render the given product config in the named
  // pose(s) and save a PNG keyed by config_hash (handled by SnapshotManager on the
  // Godot side; the result comes back as NEW_VEHICLE_SNAPSHOT).
  | 'TAKE_SNAPSHOTS';

export type GodotToReactType =
  | 'GODOT_READY'
  | 'GODOT_FOREGROUND'
  | 'NEW_VEHICLE_SNAPSHOT'
  | 'ENERGY_SITE_COMPONENT_SELECTED'
  | 'VEHICLE_MARKERS_RESPONSE'
  | 'MOVE_CAMERA_RESPONSE'
  | 'FIRST_PRODUCT_LOADED'
  | 'NEW_ENERGY_SNAPSHOT'
  | 'LOG';

export interface GodotMessage<TType extends string = string, TData = unknown> {
  type: TType;
  data?: TData;
}

export interface FrameData {
  top_margin: number;
  left_margin: number;
  width: number;
  height: number;
  animated: boolean;
  // Godot Tween params. Omitting them lets the scene fall back to its own
  // defaults (0.75s / EASE_IN_OUT), which do NOT match the official app's
  // 0.5s / TRANS_QUART(3) / EASE_OUT(1) — see CAMERA_ANIM.
  duration?: number;
  transition_type?: number;
  ease_type?: number;
  scroll_fraction: number;
}

export interface RendererDiagnostics {
  ready: boolean;
  firstProductLoaded: boolean;
  lastMessageAt?: number;
  lastMessageType?: string;
}

export interface VehicleMarkersMessage {
  type: 'VEHICLE_MARKERS_RESPONSE';
  data: VehicleMarkers;
}
