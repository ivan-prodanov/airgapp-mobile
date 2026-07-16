tool
extends ViewportContainer

class_name MainViewContainer

const ReactMsg = preload('res://mobile/scripts/ReactMsg.gd')

onready var mobile_comm: MobileComm = get_node('/root/Mobile/MobileComm')
onready var tween: Tween = get_node('Tween')
onready var viewport: Viewport = get_node('Viewport')
onready var root_node: Spatial = get_node('Viewport/root')



signal scroll_fraction_change(fraction)

var current_scroll_fraction: float = 1




var container_offset = Vector2(0, 0)
var container_size = Vector2(1, 1)

func _ready():
	mobile_comm.register_listener(ReactMsg.UPDATE_MAIN_VIEW_FRAME, funcref(self, 'on_update_main_view_frame'))
	
func on_update_main_view_frame(data: Dictionary):
	var screen_width: float = get_viewport().size.x
	var screen_height: float = get_viewport().size.y

	print('[MainViewController] screen_width: %f screen_height: %f' %[screen_width, screen_height])
	
	var top_margin = data.get('top_margin', 0)
	var left_margin = data.get('left_margin', 0)
	var width = data.get('width', screen_width)
	var height = data.get('height', screen_height)
	
	var animated = data.get('animated', True)
	var duration = data.get('duration', 0.75)
	var transition_type = data.get('transition_type', Tween.TRANS_QUART)
	var ease_type = data.get('ease_type', Tween.EASE_IN_OUT)
	
	var scale: Vector3 = Vector3.ONE *(height / screen_height)
	var center_x = left_margin +(screen_width / 2 * width / screen_width)
	var center_y = top_margin +(screen_height / 2 * scale.y)
	var position_x = center_x -(screen_width / 2)
	var position_y = center_y -(screen_height / 2)
	
	var scroll_fraction = data.get('scroll_fraction', clamp(inverse_lerp(0.4, 0.8, scale.x), 0, 1))
		
	container_offset = Vector2(screen_width / 2 - width / 2, screen_height / 2 - height / 2)
	container_size = Vector2(width, height)
	
	
	if current_scroll_fraction != scroll_fraction:
		current_scroll_fraction = scroll_fraction
		emit_signal('scroll_fraction_change', scroll_fraction)
	
	if animated:
		tween.interpolate_property(self, 'rect_position', None, Vector2(position_x, position_y), duration, transition_type, ease_type)
		tween.interpolate_property(root_node, 'scale', None, scale, duration, transition_type, ease_type)
		tween.start()
	else:
		if tween.is_active():
			tween.stop_all()
		rect_position = Vector2(position_x, position_y)
		root_node.scale = scale

func _process(delta):
	
	if not OS.has_feature('editor') or Engine.editor_hint: return
	
	var inspector = get_node('../Inspector')
	var inspector_width = 0
	
	if inspector != None and inspector.shown:
		inspector_width = inspector.get_size().x
	on_update_main_view_frame({
		'top_margin': 0,
		'left_margin': inspector_width,
		'width': get_viewport().size.x - inspector_width,
		'height': get_viewport().size.y,
		'animated': False,
		'scroll_fraction': 1,
	})

