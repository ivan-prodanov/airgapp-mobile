#pragma once

// Registers the Godot engine singleton named exactly "IOSGodotInterface" (per MobileComm.gd).
// Call once, after Main::setup2() and before Main::start(), so MobileComm._ready() finds it.
// Device only — a no-op on the simulator.
void register_ios_godot_interface();
