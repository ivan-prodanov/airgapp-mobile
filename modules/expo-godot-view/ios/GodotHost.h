#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Boots the embedded Godot 3.2 engine and renders it into a child UIView of `parentView`.
/// Device-only: on the simulator every method is a no-op (the prebuilt engine has no arm64-sim
/// slice). One instance per process — Godot is single-engine.
@interface GodotHost : NSObject

/// Starts the engine and adds the Godot GLView as a subview of `parentView`.
/// `pckPath` is the absolute path to the packed scene (`airgapp.pck`) in the app bundle.
- (instancetype)initWithParentView:(UIView *)parentView pckPath:(NSString *)pckPath;

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
