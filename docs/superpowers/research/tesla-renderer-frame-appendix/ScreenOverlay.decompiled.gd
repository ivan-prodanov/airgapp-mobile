extends ColorRect

const ReactMsg = preload('res://mobile/scripts/ReactMsg.gd')

onready var mobile_comm: MobileComm = get_node('/root/Mobile/MobileComm')
onready var tween: Tween = get_node('Tween')

func _ready():
	mobile_comm.register_listener(ReactMsg.SET_SCREEN_OVERLAY_COLOR, funcref(self, 'on_set_screen_overlay_color'))
	
func on_set_screen_overlay_color(data: Dictionary):
	var target_color = Color(data.get('color', '#000000'))
	target_color.a = data.get('alpha', 0)
	var animated: bool = data.get('animated', True)
	var duration: float = data.get('duration', 0.3)
	var transition_type = data.get('transition_type', Tween.TRANS_LINEAR)
	var ease_type = data.get('ease_type', Tween.EASE_OUT)

	if animated:
		tween.interpolate_property(self, 'color', None, target_color, duration, transition_type, ease_type)
		tween.start()
	else:
		tween.stop_all()
		self.color = target_color

