// libgodot's register_module_types() references the ARKit and Camera module entry points. Their
// real implementations live in libgodot_{arkit,camera}_module.iphone.*.a, which we deliberately
// don't link (we don't use AR/camera). Stub them out — identical to the standalone iOS export's
// dummy.cpp. Harmless on the simulator (the engine isn't linked there, so these go unreferenced).
void register_arkit_types() {}
void unregister_arkit_types() {}
void register_camera_types() {}
void unregister_camera_types() {}
