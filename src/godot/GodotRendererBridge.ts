import { ExpoGodotViewModule } from '../../modules/expo-godot-view';
import {
  createAppConfigMessage,
  createFadeRoofMessage,
  createFrameMessage,
  createGetMarkersMessage,
  createGodotConfigMessage,
  createMoveCameraMessages,
  createShowFxAboveMessage,
  createShowProductMessage,
  createTakeSnapshotsMessage,
  createThemeMessage,
  createUpdateProductMessage,
  createVehicleLightsMessage,
  vehicleIdForModel,
} from './vehicleStateAdapter';
import { hasVehicleVisualStateChanged } from './vehicleVisualState';
import { logi } from '@/services/logbus';
import type { FrameData, GodotMessage, RendererDiagnostics, VehicleMarkersMessage } from '../types/rendererMessages';
import type { VehicleMarkers } from '../types/markerTypes';
import type { CameraMode, VehicleViewState } from '../types/vehicleTypes';

type Listener<T> = (payload: T) => void;

// NEW_VEHICLE_SNAPSHOT payload: `path` is RELATIVE to user:// (i.e. the app's
// Documents dir on iOS), e.g. "snapshots/<config_hash>_THREEQUARTER.png".
export interface VehicleSnapshot {
  config_hash: string;
  pose: string;
  path: string;
}

export class GodotRendererBridge {
  private diagnostics: RendererDiagnostics = {
    ready: false,
    firstProductLoaded: false,
  };
  private markerListeners = new Set<Listener<VehicleMarkers>>();
  private diagnosticsListeners = new Set<Listener<RendererDiagnostics>>();
  private markerVisibilityListeners = new Set<Listener<boolean>>();
  private rawListeners = new Set<Listener<GodotMessage>>();
  private lastCameraMode: CameraMode = 'PARKED';
  private lastState: VehicleViewState | null = null;
  private lastFrame: FrameData | null = null;
  private pendingCameraAnimationId: string | null = null;
  private markerRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  // RN swap: the web bridge installed a `window.godot_comm` shim into the renderer <iframe> so
  // Godot could pull outbound messages and push inbound ones. Natively, ExpoGodotViewModule owns
  // the queue, so we just subscribe to Godot→host messages and route them to handleRendererMessage.
  // (Replaces the old `attachFrame(frame)` + `installComm()`.)
  attach(): () => void {
    const subscription = ExpoGodotViewModule.addListener('onGodotMessage', ({ message }) => {
      this.handleRendererMessage(message);
    });
    return () => subscription.remove();
  }

  boot(state: VehicleViewState, frame: FrameData): void {
    this.lastState = state;
    this.lastFrame = frame;
    this.lastCameraMode = state.cameraMode;

    logi('godot', 'boot', { model: state.carModel, ready: this.diagnostics.ready });
    this.send(createAppConfigMessage());
    this.send(createGodotConfigMessage());
    this.send(createThemeMessage(state.theme));
    this.send(createFrameMessage(frame));
    this.send(createShowProductMessage(state));
    this.moveCamera(state.cameraMode, false);
    this.requestMarkers();
    this.send(createVehicleLightsMessage(state, this.currentVehicleId()));
    // If the engine already signalled ready BEFORE this boot ran (RN onLayout can
    // lag engine init), the sends above are safe. If it signals ready AFTER, we
    // re-apply on GODOT_READY (see handleRendererMessage) so nothing dropped during
    // the cold-boot race leaves the car a black silhouette.
  }

  // Re-apply the current scene's visual content — the product, its lighting/env
  // (via the camera re-frame) and lights. Idempotent for an already-loaded car
  // (SHOW_PRODUCT reuses the instance), so it's safe to call on GODOT_READY or on
  // a foreground resume to recover from dropped/early messages or reclaimed GPU
  // resources. Config/theme/frame are engine-lifetime and not re-sent here.
  resync(reason: string): void {
    const state = this.lastState;
    if (!state) return;
    logi('godot', 'resync', { reason, model: state.carModel });
    this.send(createShowProductMessage(state));
    this.moveCamera(state.cameraMode, false);
    this.requestMarkers();
    this.send(createVehicleLightsMessage(state, this.currentVehicleId()));
  }

  updateFrame(frame: FrameData): void {
    this.lastFrame = frame;
    this.send(createFrameMessage(frame));
    this.requestMarkers();
  }

  updateState(next: VehicleViewState): void {
    const previous = this.lastState;
    this.lastState = next;

    if (!previous) {
      this.send(createShowProductMessage(next));
      this.moveCamera(next.cameraMode, false);
      this.send(createVehicleLightsMessage(next, this.currentVehicleId()));
      return;
    }

    if (previous.theme !== next.theme) {
      this.send(createThemeMessage(next.theme));
    }

    // Switching the rendered model can't be done with UPDATE_PRODUCT — re-issue SHOW_PRODUCT (which
    // carries the full current state), re-frame the camera for the new car, refresh markers, and
    // re-apply the lights (the freshly-instanced vehicle defaults them off).
    if (previous.carModel !== next.carModel) {
      this.send(createShowProductMessage(next));
      this.moveCamera(next.cameraMode, false);
      this.requestMarkers();
      this.send(createVehicleLightsMessage(next, this.currentVehicleId()));
      return;
    }

    if (hasVehicleVisualStateChanged(previous, next)) {
      this.send(createUpdateProductMessage(next));
    }

    if (previous.headlightsOn !== next.headlightsOn || previous.brakeLightsOn !== next.brakeLightsOn) {
      this.send(createVehicleLightsMessage(next, this.currentVehicleId()));
    }

    // Camera move re-sends SET_ENV_PARAMS, so a lighting-mode change rides the same path (re-pushes
    // the adjusted energies for the current view).
    if (previous.cameraMode !== next.cameraMode || previous.lightingMode !== next.lightingMode) {
      this.moveCamera(next.cameraMode, true);
    }
  }

  // Active-vehicle switch: re-apply the incoming car's FULL state as a fresh product, so the reveal
  // is clean whether or not the model changed (UPDATE_PRODUCT alone can't swap the model, and a
  // freshly-instanced vehicle defaults its lights off). Mirrors the carModel-change branch of
  // updateState but is driven by vehicle IDENTITY, not field diffs.
  switchVehicle(next: VehicleViewState): void {
    const previous = this.lastState;
    this.lastState = next;
    if (!previous || previous.theme !== next.theme) {
      this.send(createThemeMessage(next.theme));
    }
    this.send(createShowProductMessage(next));
    // Same model = same Godot vehicle id. SHOW_PRODUCT for an already-loaded vehicle doesn't reset
    // its dynamic closures, so an incoming same-model car would inherit the previous one's open
    // frunk/doors/windows. Force-apply the incoming car's state with UPDATE_PRODUCT. (Different-model
    // switches load a fresh vehicle via SHOW_PRODUCT, so they don't need this.)
    if (previous && previous.carModel === next.carModel) {
      this.send(createUpdateProductMessage(next));
    }
    this.moveCamera(next.cameraMode, false);
    this.requestMarkers();
    this.send(createVehicleLightsMessage(next, this.currentVehicleId()));
  }

  private currentVehicleId(): string {
    return vehicleIdForModel(this.lastState?.carModel ?? 'modelY');
  }

  moveCamera(mode: CameraMode, animated = true): void {
    const previousMode = this.lastCameraMode;
    this.lastCameraMode = mode;

    if (previousMode === 'CLIMATE' && mode !== 'CLIMATE') {
      this.send(createFadeRoofMessage(false, animated, this.currentVehicleId()));
    }

    const messages = createMoveCameraMessages(mode, animated, this.lastState?.lightingMode ?? 'mobile');
    const moveMessage = messages.find((message) => message.type === 'MOVE_CAMERA');
    const animationId = readAnimationId(moveMessage);
    this.pendingCameraAnimationId = animated ? animationId : null;
    if (animated) {
      this.emitMarkerVisibility(false);
    }

    for (const message of messages) {
      this.send(message);
    }

    // Straight-down views (climate interior + top-down) need the climate FX quads on their
    // depth-test-disabled shader, or they z-fight the floor and flicker (badly on iOS). Match the view.
    this.send(createShowFxAboveMessage(mode === 'CLIMATE' || mode === 'TOP_DOWN', this.currentVehicleId()));

    if (mode === 'CLIMATE') {
      this.send(createFadeRoofMessage(true, animated, this.currentVehicleId()));
    }

    if (!animated) {
      this.scheduleMarkerRefresh();
    }
  }

  requestMarkers(): void {
    this.send(createGetMarkersMessage(this.currentVehicleId()));
  }

  private scheduleMarkerRefresh(delayMs = 0): void {
    if (this.markerRefreshTimer !== null) {
      clearTimeout(this.markerRefreshTimer);
    }
    this.markerRefreshTimer = setTimeout(() => {
      this.markerRefreshTimer = null;
      this.requestMarkers();
    }, delayMs);
  }

  onMarkers(listener: Listener<VehicleMarkers>): () => void {
    this.markerListeners.add(listener);
    return () => this.markerListeners.delete(listener);
  }

  onDiagnostics(listener: Listener<RendererDiagnostics>): () => void {
    this.diagnosticsListeners.add(listener);
    listener(this.diagnostics);
    return () => this.diagnosticsListeners.delete(listener);
  }

  onMarkerVisibility(listener: Listener<boolean>): () => void {
    this.markerVisibilityListeners.add(listener);
    listener(!this.pendingCameraAnimationId);
    return () => this.markerVisibilityListeners.delete(listener);
  }

  onRawMessage(listener: Listener<GodotMessage>): () => void {
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }

  // Request an off-screen snapshot of `state`'s car in the given pose(s), keyed by
  // configHash. The PNG comes back via onSnapshot (NEW_VEHICLE_SNAPSHOT). Fire-and-
  // forget — SnapshotManager serializes concurrent requests on the Godot side.
  takeSnapshot(state: VehicleViewState, configHash: string, poses: string[] = ['THREEQUARTER']): void {
    this.send(createTakeSnapshotsMessage(state, configHash, poses));
  }

  onSnapshot(listener: Listener<VehicleSnapshot>): () => void {
    return this.onRawMessage((msg) => {
      if (msg.type === 'NEW_VEHICLE_SNAPSHOT' && msg.data) {
        listener(msg.data as VehicleSnapshot);
      }
    });
  }

  getDiagnostics(): RendererDiagnostics {
    return { ...this.diagnostics };
  }

  // RN swap: web pushed onto an in-JS `this.queue` that Godot drained via the iframe shim.
  // Natively we hand the message straight to the module, which enqueues it for the engine.
  private send(message: GodotMessage): void {
    ExpoGodotViewModule.sendMessageToGodot(JSON.stringify(message));
  }

  private handleRendererMessage(raw: string): void {
    let parsed: GodotMessage;
    try {
      parsed = JSON.parse(raw) as GodotMessage;
    } catch {
      parsed = { type: 'INVALID_JSON', data: raw };
    }

    this.diagnostics = {
      ...this.diagnostics,
      ready: this.diagnostics.ready || parsed.type === 'GODOT_READY',
      firstProductLoaded: this.diagnostics.firstProductLoaded || parsed.type === 'FIRST_PRODUCT_LOADED',
      lastMessageAt: Date.now(),
      lastMessageType: parsed.type,
    };

    // The engine's lifecycle signals — logged so a black-car repro shows whether
    // the renderer ever reported ready / loaded the product (the missing evidence).
    if (parsed.type === 'GODOT_READY' || parsed.type === 'FIRST_PRODUCT_LOADED') {
      logi('godot', parsed.type, {
        ready: this.diagnostics.ready,
        firstProductLoaded: this.diagnostics.firstProductLoaded,
        haveState: this.lastState != null,
      });
    }
    // Re-apply on ready: guarantees the scene content lands even if boot() fired it
    // before the engine was draining its queue (the cold-boot race → black car).
    if (parsed.type === 'GODOT_READY') {
      this.resync('godot-ready');
    }

    if (parsed.type === 'VEHICLE_MARKERS_RESPONSE') {
      if (!this.pendingCameraAnimationId) {
        const markers = (parsed as VehicleMarkersMessage).data;
        for (const listener of this.markerListeners) {
          listener(markers);
        }
        this.emitMarkerVisibility(true);
      }
    }

    if (parsed.type === 'MOVE_CAMERA_RESPONSE') {
      const animationId = readAnimationId(parsed);
      if (!this.pendingCameraAnimationId || animationId === this.pendingCameraAnimationId) {
        this.pendingCameraAnimationId = null;
        this.scheduleMarkerRefresh();
      }
    }

    for (const listener of this.rawListeners) {
      listener(parsed);
    }

    for (const listener of this.diagnosticsListeners) {
      listener(this.getDiagnostics());
    }
  }

  private emitMarkerVisibility(visible: boolean): void {
    for (const listener of this.markerVisibilityListeners) {
      listener(visible);
    }
  }
}

function readAnimationId(message: GodotMessage | undefined): string | null {
  const data = message?.data;
  if (data && typeof data === 'object' && 'animation_id' in data) {
    const animationId = (data as { animation_id?: unknown }).animation_id;
    return typeof animationId === 'string' ? animationId : null;
  }
  return null;
}
