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

#include "core/os/os.h"
#include "core/ustring.h"
#include "main/main.h"

#include <string.h>

// Defined in the prebuilt libgodot (platform/iphone/godot_iphone.cpp): creates OSIPhone + Main::setup.
int iphone_main(int width, int height, int argc, char **argv, String data_dir);
void iphone_finish();

@interface GodotHost () <GLViewDelegate> {
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
  NSLog(@"[GodotHost] GLView attached, animation started");

  return self;
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
