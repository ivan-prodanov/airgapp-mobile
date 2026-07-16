tool
class_name CameraManager
extends Node

onready var camera: Camera = get_viewport().get_camera()
onready var pivot: Spatial = get_node('CameraPivot')
onready var product_switcher = get_node('/root/Mobile/MainViewContainer/Viewport/root/ProductSwitcher')
onready var LOG: LOG = get_node('/root/Mobile/Log')
var baseline_pivot_rotation: Vector3 = Vector3(0, 0, 0)


const ReactMsg = preload('res://mobile/scripts/ReactMsg.gd')
const GodotMsg = preload('res://mobile/scripts/GodotMsg.gd')
onready var mobile_comm: MobileComm = get_node('/root/Mobile/MobileComm')


onready var tween: Tween = get_node('Tween')

var parallax_reduction = 1000
var parallax_angular_limit = 4
var parallax_return_speed = 100

var DEFAULT_ANIMATION_DURATION: float = 0.75
var DEFAULT_ANIMATION_TRANSITION: int = Tween.TRANS_QUART
var DEFAULT_ANIMATION_EASE: int = Tween.EASE_IN_OUT

var current_animation_id

func _ready():
	product_switcher.connect('on_show_product_node', self, 'update_parallax_for_product')
	mobile_comm.register_listener(ReactMsg.MOVE_CAMERA, funcref(self, 'on_move_camera'))
	tween.connect('tween_all_completed', self, 'on_tween_completed')

func update_parallax_for_product(product_node: Node, product_data: ProductData):
	if product_node is EnergySite:
		parallax_reduction = 400
		parallax_angular_limit = 15
		parallax_return_speed = 40
	elif product_node is Vehicle:
		parallax_reduction = 1000
		parallax_angular_limit = 4
		parallax_return_speed = 100

func on_move_camera(data: Dictionary):
	var rotation = Utils.vec3_from_data(data.get('rotation',[0, 0, 0]), Vector3.ZERO)
	var offset = Utils.vec3_from_data(data.get('offset',[0, 0, 0]), Vector3.ZERO)
	var cam_fov = data.get('cam_fov')
	var animated = data.get('animated', True)
	var duration = data.get('duration', DEFAULT_ANIMATION_DURATION)
	var transition_type = data.get('transition_type', DEFAULT_ANIMATION_TRANSITION)
	var ease_type = data.get('ease_type', DEFAULT_ANIMATION_EASE)
	var animation_id = data.get('animation_id')
	
	
	
	camera.rotation_degrees = Vector3(- 90, 0, 0)
		
	if animated:
		tween.interpolate_property(pivot, 'rotation_degrees', None, rotation, duration, transition_type, ease_type)
		tween.interpolate_property(camera, 'translation', None, offset, duration, transition_type, ease_type)
		if cam_fov != None: tween.interpolate_property(camera, 'fov', None, cam_fov, duration, transition_type, ease_type)
		current_animation_id = animation_id
		tween.start()
	else:
		current_animation_id = None
		tween.remove_all()
		pivot.rotation_degrees = rotation
		camera.translation = offset
		if cam_fov != None: camera.fov = cam_fov

func on_tween_completed():
	if current_animation_id != None:
		mobile_comm.send_message(GodotMsg.MOVE_CAMERA_RESPONSE, { 'animation_id': current_animation_id })
		current_animation_id = None











func is_within_rotation_thresh(target):
	var delta = baseline_pivot_rotation - target
	return abs(delta.x) < parallax_angular_limit and abs(delta.y) < parallax_angular_limit and abs(delta.z) < parallax_angular_limit

func centering_force():
	var toCenter = baseline_pivot_rotation - pivot.rotation_degrees
	pivot.rotation_degrees = pivot.rotation_degrees + toCenter / parallax_return_speed

