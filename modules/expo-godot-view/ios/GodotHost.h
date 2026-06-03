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

@end

NS_ASSUME_NONNULL_END
