import { createContext, useContext } from 'react';
import type { GodotRendererBridge } from './GodotRendererBridge';

export const BridgeContext = createContext<GodotRendererBridge | null>(null);

export function useGodotBridge(): GodotRendererBridge {
  const bridge = useContext(BridgeContext);
  if (!bridge) {
    throw new Error('Godot bridge is not available');
  }
  return bridge;
}
