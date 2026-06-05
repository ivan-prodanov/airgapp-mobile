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

@interface GodotHost () <GLViewDelegate, UIGestureRecognizerDelegate> {
  GLView *_glView;
  int _frameCount;
  bool _started;
}
@end

@implementation GodotHost

- (instancetype)initWithParentView:(UIView *)parentView pckPath:(NSString *)pckPath {
  if (!(self = [super init])) {
    return nil;
  }
  _frameCount = 0;
  _started = false;

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
  [parentView addSubview:glView];
  [glView startAnimation];
  _glView = glView;

  // RN's touch system starves Godot's own GLView gesture recognizer (touches never reach the
  // engine), so attach our own pan recognizer that coexists with RN's and feeds drags into
  // Godot's Input as screen touch/drag events.
  UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(handlePan:)];
  pan.delegate = self;
  pan.maximumNumberOfTouches = 1;
  [glView addGestureRecognizer:pan];

  NSLog(@"[GodotHost] GLView attached, animation started");

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

@end

#endif
