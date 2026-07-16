class_name AppConfigManager
extends Node

var pixel_ratio: float = 1
var font_scale: float = 1
var scale_framebuffer_on_background: bool = True

onready var mobile_comm: MobileComm = get_node('../MobileComm')

signal set_pixel_ratio(pixel_ratio)
signal set_font_scale(font_scale)

func _ready():
	mobile_comm.register_listener(ReactMsg.APP_CONFIG, funcref(self, 'on_app_config'))

func _notification(what):
	match what:
		MainLoop.NOTIFICATION_WM_FOCUS_IN:
			mobile_comm.send_message(GodotMsg.GODOT_FOREGROUND, { })

func on_app_config(data: Dictionary):
	set_pixel_ratio(data.get('pixelRatio', pixel_ratio))
	set_font_scale(data.get('fontScale', font_scale))
	scale_framebuffer_on_background = data.get('scaleFramebufferOnBackground', True)
	
func set_pixel_ratio(pixel_ratio: float):
	if self.pixel_ratio == pixel_ratio: return
	self.pixel_ratio = pixel_ratio
	emit_signal('set_pixel_ratio', pixel_ratio)

func set_font_scale(font_scale: float):
	if self.font_scale == font_scale: return
	self.font_scale = font_scale
	emit_signal('set_font_scale', font_scale)

