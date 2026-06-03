# src/types

Shared TypeScript types across the app.

Will host:
- `vehicleTypes.ts` — port of `web-shell/src/types/vehicleTypes.ts` (VehicleViewState, CameraMode, ThemeMode, VehicleConfig)
- `rendererMessages.ts` — port of `web-shell/src/types/rendererMessages.ts` (GodotMessage, FrameData, etc.)
- `markerTypes.ts` — port from web-shell
- Branded types for VIN / SessionID / RoutingAddress to prevent mix-ups in the BLE layer
