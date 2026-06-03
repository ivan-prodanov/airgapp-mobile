#import "IOSGodotInterface.h"

#if !TARGET_OS_SIMULATOR

#import <Foundation/Foundation.h>
#import "ExpoGodotView-Swift.h" // GodotBridge (Swift)

#include "core/class_db.h"
#include "core/engine.h"
#include "core/object.h"
#include "core/ustring.h"

// Godot engine singleton that MobileComm.gd binds to on iOS. It is a thin forwarder onto the Swift
// GodotBridge (the single host-side queue + RN event emitter). Contract (from MobileComm /
// LocalGodotInterface):
//   - sendMessage(json)        Godot -> host   → GodotBridge.sendMessage  (→ onGodotMessage event)
//   - pendingMessagesCount()   GDScript polls  → GodotBridge.pendingMessagesCount (host→Godot queue)
//   - getMessage()             GDScript drains → GodotBridge.getMessage
// (host→Godot is enqueued by RN via ExpoGodotViewModule.sendMessageToGodot → GodotBridge.addMessage.)
class IOSGodotInterface : public Object {
  GDCLASS(IOSGodotInterface, Object);

protected:
  static void _bind_methods() {
    ClassDB::bind_method(D_METHOD("sendMessage", "json"), &IOSGodotInterface::sendMessage);
    ClassDB::bind_method(D_METHOD("pendingMessagesCount"), &IOSGodotInterface::pendingMessagesCount);
    ClassDB::bind_method(D_METHOD("getMessage"), &IOSGodotInterface::getMessage);
  }

public:
  void sendMessage(const String &p_json) {
    @autoreleasepool {
      NSString *s = [NSString stringWithUTF8String:p_json.utf8().get_data()];
      [[GodotBridge shared] sendMessage:(s ?: @"")];
    }
  }

  int pendingMessagesCount() {
    return (int)[[GodotBridge shared] pendingMessagesCount];
  }

  String getMessage() {
    @autoreleasepool {
      NSString *s = [[GodotBridge shared] getMessage];
      return s ? String::utf8([s UTF8String]) : String();
    }
  }
};

void register_ios_godot_interface() {
  ClassDB::register_class<IOSGodotInterface>();
  Engine::get_singleton()->add_singleton(Engine::Singleton("IOSGodotInterface", memnew(IOSGodotInterface)));
  // Confirm it's visible exactly as MobileComm.gd checks it (Engine.has_singleton on iOS).
  NSLog(@"[IOSGodotInterface] engine singleton registered; has_singleton=%d",
        Engine::get_singleton()->has_singleton("IOSGodotInterface"));
}

#else

void register_ios_godot_interface() {}

#endif
