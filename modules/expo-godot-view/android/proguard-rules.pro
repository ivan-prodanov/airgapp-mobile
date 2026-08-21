# The engine reaches all of this by JNI or reflection, so a shrinker sees it as unreachable.
# Stripping any of it fails at RUNTIME with no build-time warning.

# java_godot_wrapper.cpp does FindClass("org/godotengine/godot/Godot") + GetMethodID for 17
# exact signatures, and java_godot_lib_jni.cpp binds GodotLib's natives by name.
-keep class org.godotengine.godot.** { *; }

# GodotPluginRegistry instantiates plugins via Class.forName(...).getConstructor(Godot.class),
# named only in an AndroidManifest meta-data string.
-keep class expo.modules.godotview.AndroidGodotInterface { *; }
