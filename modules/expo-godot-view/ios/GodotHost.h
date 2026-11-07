#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Boots the embedded Godot 3.2 engine and renders it into a child UIView of `parentView`.
/// Device-only: on the simulator every method is a no-op (the prebuilt engine has no arm64-sim
/// slice). One instance per process — Godot is single-engine.
@interface GodotHost : NSObject

/// Shows the engine in `parentView`, booting it on the first call. `pckPath` is the absolute path to
/// the packed scene (`airgapp.pck`) in the app bundle; it is only read by that first call.
///
/// The host lives for the whole process. The engine can only boot once (`iphone_main` builds
/// process-wide singletons), and GLView's display link calls a non-retained delegate every frame, so
/// a host that died with its view would crash the next frame. Instead a remounted view takes over
/// the same running engine.
+ (GodotHost *)attachToParentView:(UIView *)parentView pckPath:(NSString *)pckPath;

/// Stops rendering and removes the GLView, unless a newer view has already taken the engine over.
/// Safe to call from the parent's `deinit`: `parentView` is only compared, never retained.
- (void)detachFromParentView:(UIView *)parentView;

- (void)pause;
- (void)resume;

/// Toggle the free-orbit pan recognizer (attached to the PARENT view, not the GLView, so it
/// works while GLView's own touch handling stays disabled). When `enabled` is YES, drag
/// gestures over the Godot area are converted to InputEventScreenTouch/Drag and parsed into
/// Godot's Input system; the injected GDScript in MainViewContainer.gd consumes them and
/// orbits the camera pivot. When NO (default), no touches reach Godot at all.
- (void)setOrbitEnabled:(BOOL)enabled;

@end

NS_ASSUME_NONNULL_END
