#import "GodotHost.h"

#if TARGET_OS_SIMULATOR

// ───────────────────────── Simulator: no engine (no arm64-sim slice) ─────────────────────────
@implementation GodotHost
- (instancetype)initWithParentView:(UIView *)parentView pckPath:(NSString *)pckPath {
  if ((self = [super init])) {
    NSLog(@"[GodotHost|sim] no-op (engine is device-only)");
  }
  return self;
}
- (void)pause {}
- (void)resume {}
- (void)setOrbitEnabled:(BOOL)enabled {}
@end

#else

// ───────────────────────────────── Device: real Godot 3.2 ────────────────────────────────────
#import "gl_view.h"
#import "IOSGodotInterface.h"

#include "core/os/input.h"
#include "core/os/input_event.h"
#include "core/os/os.h"
#include "core/ustring.h"
#include "main/main.h"

#include <string.h>

// Defined in the prebuilt libgodot (platform/iphone/godot_iphone.cpp): creates OSIPhone + Main::setup.
int iphone_main(int width, int height, int argc, char **argv, String data_dir);
void iphone_finish();

// CGDataProvider release callback for the glReadPixels buffer backing the background snapshot image.
static void GodotHostReleasePixelData(void *info, const void *data, size_t size) {
  free((void *)data);
}

@interface GodotHost () <GLViewDelegate, UIGestureRecognizerDelegate> {
  GLView *_glView;
  __weak UIView *_parentView;        // weak — RN owns the lifetime of ExpoGodotView
  UIPanGestureRecognizer *_orbitPan; // dynamic: created when orbit is enabled, removed when disabled
  int _frameCount;
  bool _started;

  // Background-snapshot overlay. The GLView is a CAEAGLLayer, whose GPU-side drawable is invisible
  // to iOS's app-switcher snapshot → the render area captures as pure black. Before backgrounding
  // we glReadPixels the last frame into this UIImageView and show it, so iOS snapshots a real image.
  UIImageView *_snapshotView;
  BOOL _captureRequested; // set on resign-active; the next drawView: reads the frame into _snapshotView
}
- (void)captureBackgroundSnapshotFromView:(GLView *)view;
- (void)appWillResignActive;
- (void)appDidEnterBackground;
- (void)appWillEnterForeground;
- (void)appDidBecomeActive;
@end

@implementation GodotHost

- (instancetype)initWithParentView:(UIView *)parentView pckPath:(NSString *)pckPath {
  if (!(self = [super init])) {
    return nil;
  }
  _frameCount = 0;
  _started = false;
  _parentView = parentView;
  _orbitPan = nil;

  CGFloat scale = parentView.window ? parentView.window.screen.scale : UIScreen.mainScreen.scale;
  int w = (int)(parentView.bounds.size.width * scale);
  int h = (int)(parentView.bounds.size.height * scale);

  // argv: <exe> --main-pack <abs path to airgapp.pck>. iphone_main chdir()s to <exe>'s dir.
  NSString *exePath = [[NSBundle mainBundle] executablePath];
  static char *argv[8];
  int argc = 0;
  argv[argc++] = strdup([exePath UTF8String]);
  argv[argc++] = strdup("--main-pack");
  argv[argc++] = strdup([pckPath UTF8String]);
  argv[argc] = NULL;

  NSString *docs = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES)[0];

  NSLog(@"[GodotHost] iphone_main(%d, %d) pck=%@", w, h, pckPath);
  int err = iphone_main(w, h, argc, argv, String::utf8([docs UTF8String]));
  if (err != 0) {
    NSLog(@"[GodotHost] iphone_main FAILED err=%d", err);
    return self;
  }

  // The GLView MUST be created after iphone_main (it reads project settings to init the GL context).
  GLView *glView = [[GLView alloc] initWithFrame:parentView.bounds];
  glView.delegate = self;
  glView.useCADisplayLink = YES;
  glView.animationInterval = 1.0 / 60.0;
  glView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  // Block ALL iOS touch events from reaching the GLView.
  //
  // ROOT CAUSE (2026-06-21): Godot 3.2's gl_view.mm has touchesBegan/Moved/Ended methods baked
  // into the prebuilt iOS engine binary. They convert UITouch → InputEventScreenTouch/Drag and
  // call Input::parse_input_event. On iOS 26 / A19 Pro Metal-backed GLES2, this internal Godot
  // C++ touch processing exercises GL state paths that trip the GL_INVALID_ENUM accumulation
  // FAST enough to hit SIGTRAP/SIGABRT within seconds of any touch on the GLView.
  //
  // VERIFIED 2026-06-21: stripping the GDScript `_input(event)` handler from MainViewContainer.gd
  // (so no GDScript consumes touches) did NOT fix the crash — proves the bug is in Godot's C++
  // touch handling, not the GDScript dispatch above it. Only solid fix achievable without
  // rebuilding Godot 3.2 from source: block touches at the iOS UIView level so neither
  // touchesBegan nor any pan recognizer ever fires on the GLView.
  //
  // Tradeoff: no future car-tap/swipe interactions via Godot until we either (a) rebuild Godot
  // from source with iOS 26 GLES2 fixes (Phase 8), or (b) build a proper render-on-Metal path.
  // Expose this as a prop when those land.
  glView.userInteractionEnabled = NO;
  [parentView addSubview:glView];
  [glView startAnimation];
  _glView = glView;

  // Orbit pan recognizer is created on demand via setOrbitEnabled: (called from RN through the
  // `orbitEnabled` prop). When attached, it lives on PARENTVIEW (not glView) so it can fire even
  // with glView.userInteractionEnabled=NO. RN sibling UI above the parent absorbs touches it owns
  // (bottom sheets, buttons); only touches landing on the bare Godot area reach our recognizer.
  NSLog(@"[GodotHost] GLView attached, animation started");

  // App-lifecycle hooks that drive the background-snapshot overlay (see _snapshotView above).
  NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
  [nc addObserver:self selector:@selector(appWillResignActive) name:UIApplicationWillResignActiveNotification object:nil];
  [nc addObserver:self selector:@selector(appDidEnterBackground) name:UIApplicationDidEnterBackgroundNotification object:nil];
  [nc addObserver:self selector:@selector(appWillEnterForeground) name:UIApplicationWillEnterForegroundNotification object:nil];
  [nc addObserver:self selector:@selector(appDidBecomeActive) name:UIApplicationDidBecomeActiveNotification object:nil];

  return self;
}

// One-finger drag → Godot InputEventScreenTouch/Drag (the dev injector's free-orbit listens for
// these). Coords are in framebuffer pixels (points × contentScaleFactor).
- (void)handlePan:(UIPanGestureRecognizer *)pan {
  if (!_started) {
    return;
  }
  CGFloat scale = _glView.contentScaleFactor;
  CGPoint loc = [pan locationInView:_glView];
  Vector2 pos(loc.x * scale, loc.y * scale);

  switch (pan.state) {
    case UIGestureRecognizerStateBegan: {
      [pan setTranslation:CGPointZero inView:_glView];
      Ref<InputEventScreenTouch> st;
      st.instance();
      st->set_index(0);
      st->set_position(pos);
      st->set_pressed(true);
      Input::get_singleton()->parse_input_event(st);
    } break;
    case UIGestureRecognizerStateChanged: {
      CGPoint t = [pan translationInView:_glView];
      [pan setTranslation:CGPointZero inView:_glView];
      Ref<InputEventScreenDrag> sd;
      sd.instance();
      sd->set_index(0);
      sd->set_position(pos);
      sd->set_relative(Vector2(t.x * scale, t.y * scale));
      Input::get_singleton()->parse_input_event(sd);
    } break;
    case UIGestureRecognizerStateEnded:
    case UIGestureRecognizerStateCancelled:
    case UIGestureRecognizerStateFailed: {
      Ref<InputEventScreenTouch> st;
      st.instance();
      st->set_index(0);
      st->set_position(pos);
      st->set_pressed(false);
      Input::get_singleton()->parse_input_event(st);
    } break;
    default:
      break;
  }
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer
    shouldRecognizeSimultaneouslyWithGestureRecognizer:(UIGestureRecognizer *)otherGestureRecognizer {
  return YES;
}

// Reject touches that start near the left/right screen edges. iOS owns those for the
// system swipe-back / swipe-forward gestures (the back-nav on iOS 7+). If our orbit pan
// also claims them, we get a partial drag → cancelled → `_orbit_velocity` is set →
// inertia runs in `_physics_process` while the back-navigation triggers MOVE_CAMERA to
// the PARKED preset → both code paths mutate `pivot.rotation_degrees` simultaneously and
// the engine traps. Letting iOS own the edge cleanly avoids the whole conflict.
- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gestureRecognizer
       shouldReceiveTouch:(UITouch *)touch {
  UIView *v = gestureRecognizer.view;
  if (v == nil) return YES;
  CGPoint loc = [touch locationInView:v];
  static const CGFloat kEdgeReserve = 32.0; // matches iOS's UIScreenEdgePanGestureRecognizer hit zone
  if (loc.x < kEdgeReserve || loc.x > v.bounds.size.width - kEdgeReserve) {
    return NO;
  }
  return YES;
}

// GLViewDelegate — called each frame with the GLView's framebuffer bound + context current.
// Replicates platform/iphone/app_delegate.mm's drawView: state machine.
- (void)drawView:(GLView *)view {
  switch (_frameCount) {
    case 0: {
      OS::VideoMode vm;
      vm.width = (int)(view.bounds.size.width * view.contentScaleFactor);
      vm.height = (int)(view.bounds.size.height * view.contentScaleFactor);
      vm.fullscreen = true;
      vm.resizable = false;
      OS::get_singleton()->set_video_mode(vm);
      _frameCount++;
    } break;
    case 1: {
      Main::setup2();
      // Register the IOSGodotInterface engine singleton before Main::start() instantiates the
      // scene (MobileComm._ready binds to it).
      register_ios_godot_interface();
      _frameCount++;
    } break;
    case 2: {
      Main::start();
      _started = true;
      _frameCount++;
      NSLog(@"[GodotHost] Main::start() done — scene running");
    } break;
    default: {
      Main::iteration();
    } break;
  }

  // The frame is now rendered into gl_view's bound framebuffer but NOT yet presented (present, which
  // discards it under retained-backing=NO, happens after this delegate returns). This is the one safe
  // window to read it back for the background snapshot.
  if (_captureRequested && _started) {
    _captureRequested = NO;
    [self captureBackgroundSnapshotFromView:view];
  }
}

// MARK: - Background snapshot (CAEAGLLayer app-switcher black-void workaround)

// Read the freshly-rendered GL frame into a UIImage and stash it in the overlay (kept hidden until
// the app actually backgrounds). Called from drawView: while gl_view's framebuffer is still bound.
- (void)captureBackgroundSnapshotFromView:(GLView *)view {
  const int w = (int)(view.bounds.size.width * view.contentScaleFactor);
  const int h = (int)(view.bounds.size.height * view.contentScaleFactor);
  if (w <= 0 || h <= 0) {
    return;
  }

  const size_t bytesPerRow = (size_t)w * 4;
  const size_t length = bytesPerRow * (size_t)h;
  GLubyte *pixels = (GLubyte *)malloc(length);
  if (pixels == NULL) {
    return;
  }
  glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, pixels);

  CGDataProviderRef provider = CGDataProviderCreateWithData(NULL, pixels, length, GodotHostReleasePixelData);
  CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
  // GL bytes are R,G,B,A; skip alpha (Godot's opaque frame can carry alpha=0, which would otherwise
  // premultiply the whole image to black).
  CGImageRef cg = CGImageCreate(w, h, 8, 32, bytesPerRow, cs,
                                kCGImageAlphaNoneSkipLast | kCGBitmapByteOrder32Big,
                                provider, NULL, NO, kCGRenderingIntentDefault);
  // glReadPixels' origin is bottom-left; DownMirrored flips it to UIKit's top-left.
  UIImage *img = cg ? [UIImage imageWithCGImage:cg scale:view.contentScaleFactor orientation:UIImageOrientationDownMirrored] : nil;
  CGImageRelease(cg);
  CGColorSpaceRelease(cs);
  CGDataProviderRelease(provider);
  if (img == nil) {
    return;
  }

  UIView *parent = _parentView;
  if (parent == nil) {
    return;
  }
  if (_snapshotView == nil) {
    _snapshotView = [[UIImageView alloc] initWithFrame:parent.bounds];
    _snapshotView.contentMode = UIViewContentModeScaleToFill;
    _snapshotView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    _snapshotView.userInteractionEnabled = NO;
    _snapshotView.hidden = YES;
    [parent addSubview:_snapshotView];
  }
  _snapshotView.frame = parent.bounds;
  _snapshotView.image = img;
}

// Resign-active fires BEFORE iOS takes the app-switcher snapshot, and while GL is still safe to touch.
// Force one synchronous frame so drawView: captures the current scene into the overlay.
- (void)appWillResignActive {
  if (!_started || _glView == nil) {
    return;
  }
  _captureRequested = YES;
  [_glView drawView];
  _captureRequested = NO; // clear in case drawView bailed (e.g. animation already inactive)
}

// Actually entering the background: reveal the captured frame so the snapshot shows it, and stop
// rendering (GL access in the background risks a watchdog kill).
- (void)appDidEnterBackground {
  if (_snapshotView != nil && _snapshotView.image != nil) {
    UIView *parent = _parentView;
    if (parent != nil) {
      [parent bringSubviewToFront:_snapshotView];
    }
    _snapshotView.hidden = NO;
  }
  if (_started) {
    [_glView stopAnimation];
  }
}

// Resume rendering behind the overlay so a fresh frame is ready before we uncover the GL surface.
- (void)appWillEnterForeground {
  if (_started && _glView != nil) {
    [_glView startAnimation];
  }
}

- (void)appDidBecomeActive {
  _snapshotView.hidden = YES;
}

- (void)pause {
  if (_started) {
    [_glView stopAnimation];
  }
}

- (void)resume {
  if (_started) {
    [_glView startAnimation];
  }
}

- (void)setOrbitEnabled:(BOOL)enabled {
  if (enabled) {
    if (_orbitPan != nil) return;
    UIView *parent = _parentView;
    if (parent == nil) return;
    _orbitPan = [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(handlePan:)];
    _orbitPan.delegate = self;
    _orbitPan.maximumNumberOfTouches = 1;
    [parent addGestureRecognizer:_orbitPan];
    NSLog(@"[GodotHost] orbit recognizer attached");
  } else {
    if (_orbitPan == nil) return;
    [_orbitPan.view removeGestureRecognizer:_orbitPan];
    _orbitPan = nil;
    NSLog(@"[GodotHost] orbit recognizer removed");
  }
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

@end

#endif
