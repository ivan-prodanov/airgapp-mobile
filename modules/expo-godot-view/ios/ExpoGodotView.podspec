require 'json'

godot_src = '/Users/ivan/Work/airgapp/godot-src'
engine_dir = '/Users/ivan/Work/airgapp/mobile/modules/expo-godot-view/ios/engine'

Pod::Spec.new do |s|
  s.name           = 'ExpoGodotView'
  s.version        = '1.0.0'
  s.summary        = 'Godot 3.2 engine embedded as a native RN view (Tesla car visualization).'
  s.description    = 'Embeds the Godot 3.2 iOS engine as a child UIView via the Expo Modules API.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Frameworks the prebuilt libgodot references. They all exist on the simulator too, so listing
  # them universally is harmless (the engine .a itself is linked device-only, below).
  s.frameworks = [
    'OpenGLES', 'GLKit', 'QuartzCore', 'CoreGraphics', 'CoreMedia', 'CoreMotion', 'CoreVideo',
    'AVFoundation', 'AudioToolbox', 'CoreAudio', 'GameController', 'GameKit', 'MediaPlayer',
    'SystemConfiguration', 'Security'
  ]
  # -weak_framework so Xcode's IAP capability inference doesn't trigger (free-team signing).
  s.weak_frameworks = ['StoreKit']

  # The packed Godot scene, copied into the .app bundle root (loaded via --main-pack at runtime).
  s.resources = ['airgapp.pck']

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    # Compile GodotHost.mm/IOSGodotInterface.mm against the Godot 3.2 source headers (matches the
    # prebuilt .a). platform/iphone is needed for platform_config.h / os_iphone.h / gl_view.h.
    'HEADER_SEARCH_PATHS' => "\"#{godot_src}\" \"#{godot_src}/platform/iphone\" \"$(PODS_TARGET_SRCROOT)/godot_gen\"",
    # DEBUG_METHODS_ENABLED MUST match the prebuilt debug template: it selects the bind_methodfi
    # overload (MethodDefinition vs const char*) that ClassDB::bind_method generates. Without it the
    # app link fails with an undefined bind_methodfi(const char*).
    'GCC_PREPROCESSOR_DEFINITIONS' => 'IPHONE_ENABLED=1 UNIX_ENABLED=1 GLES2_ENABLED=1 DEBUG_METHODS_ENABLED=1 $(inherited)',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'gnu++14',
    'CLANG_WARN_DOCUMENTATION_COMMENTS' => 'NO',
  }

  # Link the device-only engine static lib into the APP target (iphoneos only — the fat.a has no
  # arm64-simulator slice, so the simulator build must NOT reference it). No -force_load: we pull
  # only the referenced engine objects and never Godot's baked-in main()/AppDelegate (which would
  # collide with Expo's AppDelegate).
  # NO -ObjC / -force_load: a direct [GLView alloc] reference pulls GLView.o on its own, while
  # leaving Godot's baked-in main()/AppDelegate objects unreferenced (force-loading them would
  # collide AppDelegate with Expo's). The .a is appended after the pod objects so pull-on-reference
  # resolves the engine symbols.
  # $(inherited) is REQUIRED: an [sdk=...] conditional does not inherit the base OTHER_LDFLAGS,
  # so without it we'd clobber Expo/React's -force_load flags for device builds.
  s.user_target_xcconfig = {
    'OTHER_LDFLAGS[sdk=iphoneos*]' => "$(inherited) \"#{engine_dir}/libgodot.iphone.debug.fat.a\"",
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
